import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import {
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { graceTimeFor, graceTimeSql } from '../../common/grace-period';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { ClassSchedule } from '../../database/entities/class-schedule.entity';
import { Enrollment } from '../../database/entities/enrollment.entity';
import { Module } from '../../database/entities/module.entity';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { User, UserRole } from '../users/entities/user.entity';
import { ImportIssue, IMPORT_LIMITS } from './excel/import-issue';
import {
  ParsedSchedule,
  parseSchedules,
  SCHEDULE_COLUMNS,
} from './excel/parse-schedules';
import {
  ParsedStudent,
  parseStudents,
  STUDENT_COLUMNS,
} from './excel/parse-students';
import { readSheet } from './excel/read-sheet';
import { AddModuleStudentDto } from './dto/add-module-student.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { hashPasswords } from './password-hasher';
import { ImportFiles } from './xlsx-upload';

export type ImportStudentStatus = 'new' | 'existing' | 'reactivated';

interface ClassifiedStudent extends ParsedStudent {
  status: ImportStudentStatus;
  userId: string | null;
  /** True when an existing user's name or email will change. */
  changed: boolean;
}

interface ImportAnalysis {
  students: ClassifiedStudent[];
  schedules: ParsedSchedule[];
  issues: ImportIssue[];
  warnings: ImportIssue[];
}

const PASSWORD_HASH_COST = 12;
const INSERT_CHUNK_SIZE = 500;
// Arbitrary application-wide key for pg_advisory_xact_lock: serializes
// module activations so two admins cannot activate modules at the same time.
const MODULE_ACTIVATION_LOCK_KEY = 351_013;
const DEFAULT_TIMEZONE = 'America/La_Paz';

@Injectable()
export class AcademicModulesService {
  constructor(
    @InjectRepository(Module) private readonly modules: Repository<Module>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Enrollment)
    private readonly enrollments: Repository<Enrollment>,
    @InjectRepository(ClassSchedule)
    private readonly schedules: Repository<ClassSchedule>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /** The single active module (RN-01), or null when none has been activated. */
  getActiveModule(): Promise<Module | null> {
    return this.modules.findOne({ where: { isActive: true } });
  }

  async getActiveModuleSummary() {
    const module = await this.getActiveModule();
    if (!module) return { activeModule: null };

    const [studentsCount, schedulesCount, range] = await Promise.all([
      this.enrollments.count({ where: { moduleId: module.id } }),
      this.schedules.count({ where: { moduleId: module.id } }),
      this.schedules
        .createQueryBuilder('schedule')
        // Format in SQL: the pg driver would turn raw DATE values into
        // local-time Date objects and shift the day when serialized.
        .select("TO_CHAR(MIN(schedule.classDate), 'YYYY-MM-DD')", 'firstDate')
        .addSelect("TO_CHAR(MAX(schedule.classDate), 'YYYY-MM-DD')", 'lastDate')
        .where('schedule.moduleId = :moduleId', { moduleId: module.id })
        .getRawOne<{ firstDate: string | null; lastDate: string | null }>(),
    ]);

    return {
      activeModule: {
        id: module.id,
        name: module.name,
        // Modules are only activated when created, so createdAt is the activation time.
        activatedAt: module.createdAt,
        graceMinutes: module.graceMinutes,
        studentsCount,
        schedulesCount,
        firstDate: range?.firstDate ?? null,
        lastDate: range?.lastDate ?? null,
      },
    };
  }

  /** Lists active and closed modules with their preserved roster and dates. */
  async listModules() {
    const modules = await this.modules.find({ order: { createdAt: 'DESC' } });
    if (modules.length === 0) return [];

    const ids = modules.map((module) => module.id);
    const [enrollmentCounts, scheduleStats] = await Promise.all([
      this.enrollments
        .createQueryBuilder('enrollment')
        .select('enrollment.moduleId', 'moduleId')
        .addSelect('COUNT(*)', 'count')
        .where('enrollment.moduleId IN (:...ids)', { ids })
        .groupBy('enrollment.moduleId')
        .getRawMany<{ moduleId: string; count: string }>(),
      this.schedules
        .createQueryBuilder('schedule')
        .select('schedule.moduleId', 'moduleId')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          "TO_CHAR(MIN(schedule.classDate), 'YYYY-MM-DD')",
          'firstDate',
        )
        .addSelect("TO_CHAR(MAX(schedule.classDate), 'YYYY-MM-DD')", 'lastDate')
        .where('schedule.moduleId IN (:...ids)', { ids })
        .groupBy('schedule.moduleId')
        .getRawMany<{
          moduleId: string;
          count: string;
          firstDate: string | null;
          lastDate: string | null;
        }>(),
    ]);

    const studentsByModule = new Map(
      enrollmentCounts.map((row) => [row.moduleId, Number(row.count)]),
    );
    const schedulesByModule = new Map(
      scheduleStats.map((row) => [row.moduleId, row]),
    );
    return modules.map((module) => {
      const stats = schedulesByModule.get(module.id);
      return {
        id: module.id,
        name: module.name,
        status: module.isActive ? 'active' : 'closed',
        isActive: module.isActive,
        activatedAt: module.createdAt,
        graceMinutes: module.graceMinutes,
        studentsCount: studentsByModule.get(module.id) ?? 0,
        schedulesCount: Number(stats?.count ?? 0),
        firstDate: stats?.firstDate ?? null,
        lastDate: stats?.lastDate ?? null,
      };
    });
  }

  async getModuleStudents(moduleId: string) {
    const module = await this.modules.findOne({ where: { id: moduleId } });
    if (!module) throw new NotFoundException('No se encontró el módulo');
    const enrollments = await this.enrollments
      .createQueryBuilder('enrollment')
      .withDeleted()
      .leftJoinAndSelect('enrollment.student', 'student')
      .withDeleted()
      .where('enrollment.moduleId = :moduleId', { moduleId })
      .orderBy('student.fullName', 'ASC', 'NULLS LAST')
      .addOrderBy('student.registrationNo', 'ASC')
      .getMany();
    return {
      module: { id: module.id, name: module.name, isActive: module.isActive },
      students: enrollments.map(({ student, assignedAt }) => ({
        id: student.id,
        registrationNo: student.registrationNo,
        fullName: student.fullName,
        email: student.email,
        assignedAt,
      })),
    };
  }

  async getActiveModuleSchedules() {
    const module = await this.getActiveModule();
    if (!module) throw new NotFoundException('No hay un módulo activo');
    const schedules = await this.schedules.find({
      where: { moduleId: module.id },
      order: { classDate: 'ASC', startTime: 'ASC' },
    });
    return { module: { id: module.id, name: module.name }, schedules };
  }

  async updateActiveSchedule(
    scheduleId: string,
    dto: UpdateScheduleDto,
    actor: AuthenticatedUser,
  ) {
    if (dto.endTime <= dto.startTime) {
      throw new UnprocessableEntityException(
        'La hora de fin debe ser posterior a la hora de inicio.',
      );
    }
    if (dto.classDate < this.today()) {
      throw new UnprocessableEntityException(
        'Solo se pueden editar clases de hoy en adelante.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await this.lockModuleChanges(manager);
      const module = await manager
        .getRepository(Module)
        .findOne({ where: { isActive: true } });
      if (!module) throw new NotFoundException('No hay un módulo activo');
      const schedules = manager.getRepository(ClassSchedule);
      const schedule = await schedules.findOne({
        where: { id: scheduleId, moduleId: module.id },
      });
      if (!schedule)
        throw new NotFoundException(
          'No se encontró la clase del módulo activo',
        );
      if (schedule.classDate < this.today()) {
        throw new UnprocessableEntityException(
          'No se pueden editar clases pasadas.',
        );
      }
      const duplicate = await schedules.findOne({
        where: { moduleId: module.id, classDate: dto.classDate },
      });
      if (duplicate && duplicate.id !== schedule.id) {
        throw new ConflictException(
          'Ya existe una clase programada para esa fecha.',
        );
      }

      const previousValue = {
        classDate: schedule.classDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      };
      schedule.classDate = dto.classDate;
      schedule.startTime = dto.startTime;
      schedule.endTime = dto.endTime;
      schedule.graceTime = graceTimeFor(
        dto.startTime,
        dto.endTime,
        module.graceMinutes,
      );
      const updated = await schedules.save(schedule);
      await manager.getRepository(AuditLog).save({
        userId: actor.id,
        moduleId: module.id,
        action: 'module.schedule_updated',
        affectedEntity: 'class_schedules',
        affectedRecordId: schedule.id,
        previousValue,
        newValue: {
          classDate: dto.classDate,
          startTime: dto.startTime,
          endTime: dto.endTime,
          graceTime: schedule.graceTime,
        },
      });
      return { schedule: updated };
    });
  }

  /** Validates both spreadsheets without writing anything (RF-16 preview). */
  async preview(files: ImportFiles) {
    const [analysis, active] = await Promise.all([
      this.analyze(files),
      this.getActiveModule(),
    ]);
    return {
      valid: analysis.issues.length === 0,
      activeModule: active ? { id: active.id, name: active.name } : null,
      students: {
        total: analysis.students.length,
        new: this.countByStatus(analysis.students, 'new'),
        existing: this.countByStatus(analysis.students, 'existing'),
        reactivated: this.countByStatus(analysis.students, 'reactivated'),
        rows: analysis.students.map((student) => ({
          row: student.row,
          registrationNo: student.registrationNo,
          fullName: student.fullName,
          email: student.email,
          status: student.status,
          changed: student.changed,
        })),
      },
      schedules: {
        total: analysis.schedules.length,
        firstDate: analysis.schedules[0]?.classDate ?? null,
        lastDate: analysis.schedules.at(-1)?.classDate ?? null,
        rows: analysis.schedules,
      },
      ...this.issueReport(analysis),
    };
  }

  /**
   * RF-13: deactivates the current module and activates a new one with the
   * imported students and class dates, atomically. Previous modules and their
   * attendance stay in the database (RN-08); the new module starts empty.
   */
  async activate(
    name: string,
    graceMinutes: number,
    files: ImportFiles,
    actor: AuthenticatedUser,
  ) {
    // Never trust a previous preview: validate the files again.
    const analysis = await this.analyze(files);
    if (analysis.issues.length > 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'The uploaded files contain errors',
        ...this.issueReport(analysis),
      });
    }

    const newStudents = analysis.students.filter((s) => s.status === 'new');
    // Initial password = registration number. Hashed before opening the
    // transaction so the database connection is not held while hashing.
    const passwordHashes = await hashPasswords(
      newStudents.map((student) => student.registrationNo),
      PASSWORD_HASH_COST,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockModuleChanges(manager);

        const moduleRepository = manager.getRepository(Module);
        const previous = await moduleRepository.findOne({
          where: { isActive: true },
        });
        if (previous) {
          await moduleRepository.update(
            { id: previous.id },
            { isActive: false },
          );
        }
        const module = await moduleRepository.save(
          moduleRepository.create({ name, isActive: true, graceMinutes }),
        );

        const studentIds: string[] = [];
        for (const chunk of this.chunk(
          newStudents.map((student, index) => ({ student, index })),
        )) {
          const result = await manager
            .createQueryBuilder()
            .insert()
            .into(User)
            .values(
              chunk.map(({ student, index }) => ({
                role: UserRole.STUDENT,
                registrationNo: student.registrationNo,
                passwordHash: passwordHashes[index],
                fullName: student.fullName,
                email: student.email,
                degreeProgram: null,
              })),
            )
            .returning(['id'])
            .execute();
          studentIds.push(
            ...(result.raw as Array<{ id: string }>).map((row) =>
              String(row.id),
            ),
          );
        }

        const toUpdate = analysis.students.filter(
          (student) =>
            student.userId &&
            (student.changed || student.status === 'reactivated'),
        );
        for (const chunk of this.chunk(toUpdate)) {
          const params: unknown[] = [];
          const rows = chunk.map((student) => {
            params.push(student.userId, student.fullName, student.email);
            const base = params.length - 2;
            return `($${base}::bigint, $${base + 1}::varchar, $${base + 2}::varchar)`;
          });
          // Single statement per chunk; also restores soft-deleted students
          // who are being re-admitted in the new module.
          await manager.query(
            `UPDATE "users" AS u
             SET "full_name" = v.full_name, "email" = v.email,
                 "deleted_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
             FROM (VALUES ${rows.join(', ')}) AS v(id, full_name, email)
             WHERE u."id" = v.id AND u."role" = 'student'`,
            params,
          );
        }

        const enrolledIds = [
          ...studentIds,
          ...analysis.students
            .filter((student) => student.userId)
            .map((student) => student.userId as string),
        ];
        for (const chunk of this.chunk(enrolledIds)) {
          await manager
            .createQueryBuilder()
            .insert()
            .into(Enrollment)
            .values(
              chunk.map((studentId) => ({ studentId, moduleId: module.id })),
            )
            .execute();
        }

        for (const chunk of this.chunk(analysis.schedules)) {
          await manager
            .createQueryBuilder()
            .insert()
            .into(ClassSchedule)
            .values(
              chunk.map((schedule) => ({
                moduleId: module.id,
                classDate: schedule.classDate,
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                graceTime: graceTimeFor(
                  schedule.startTime,
                  schedule.endTime,
                  graceMinutes,
                ),
              })),
            )
            .execute();
        }

        const summary = {
          graceMinutes,
          students: {
            total: analysis.students.length,
            new: newStudents.length,
            existing: this.countByStatus(analysis.students, 'existing'),
            reactivated: this.countByStatus(analysis.students, 'reactivated'),
          },
          schedules: {
            total: analysis.schedules.length,
            firstDate: analysis.schedules[0]?.classDate ?? null,
            lastDate: analysis.schedules.at(-1)?.classDate ?? null,
          },
        };

        const auditRepository = manager.getRepository(AuditLog);
        await auditRepository.save(
          auditRepository.create({
            userId: actor.id,
            moduleId: module.id,
            action: 'module.activated',
            affectedEntity: 'modules',
            affectedRecordId: module.id,
            previousValue: previous
              ? { id: previous.id, name: previous.name, isActive: true }
              : null,
            newValue: { id: module.id, name: module.name, ...summary },
          }),
        );

        return {
          module: { id: module.id, name: module.name },
          previousModule: previous
            ? { id: previous.id, name: previous.name }
            : null,
          ...summary,
        };
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { driverError?: { code?: string } })
          .driverError?.code === '23505'
      ) {
        throw new ConflictException(
          'Data changed while activating the module; validate the files again',
        );
      }
      throw error;
    }
  }

  /**
   * Changes the active module's grace period. Only classes from today on are
   * recalculated: past classes keep the tolerance they were marked with.
   */
  async updateGracePeriod(graceMinutes: number, actor: AuthenticatedUser) {
    return this.dataSource.transaction(async (manager) => {
      await this.lockModuleChanges(manager);
      const moduleRepository = manager.getRepository(Module);
      const module = await moduleRepository.findOne({
        where: { isActive: true },
      });
      if (!module) throw new NotFoundException('No active module');

      const previous = module.graceMinutes;
      if (previous === graceMinutes) {
        return { graceMinutes, updatedSchedules: 0, unchanged: true };
      }

      await moduleRepository.update({ id: module.id }, { graceMinutes });
      const updated = await manager.query<Array<{ id: string }>>(
        `UPDATE "class_schedules" s
         SET "grace_time" = ${graceTimeSql('s', '$2')},
             "updated_at" = CURRENT_TIMESTAMP
         WHERE s."module_id" = $1 AND s."deleted_at" IS NULL
           AND s."class_date" >= $3::date
         RETURNING s."id"`,
        [module.id, graceMinutes, this.today()],
      );
      // node-postgres returns [rows, rowCount] for UPDATE ... RETURNING.
      const rows = (Array.isArray(updated[0]) ? updated[0] : updated) as Array<{
        id: string;
      }>;

      const auditRepository = manager.getRepository(AuditLog);
      await auditRepository.save(
        auditRepository.create({
          userId: actor.id,
          moduleId: module.id,
          action: 'module.grace_updated',
          affectedEntity: 'modules',
          affectedRecordId: module.id,
          previousValue: { graceMinutes: previous },
          newValue: { graceMinutes, updatedSchedules: rows.length },
        }),
      );

      return { graceMinutes, updatedSchedules: rows.length, unchanged: false };
    });
  }

  /**
   * Enrolls one student in the active module (for students missing from the
   * imported Excel). Existing accounts are reused; new ones get their
   * registration number as initial password, like the import.
   */
  async addStudentToActiveModule(
    dto: AddModuleStudentDto,
    actor: AuthenticatedUser,
  ) {
    const known = await this.users.findOne({
      where: { registrationNo: dto.registrationNo },
      withDeleted: true,
    });
    // Hash outside the transaction so the connection is not held meanwhile.
    let passwordHash = known
      ? null
      : await hash(dto.registrationNo, PASSWORD_HASH_COST);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockModuleChanges(manager);
        const module = await manager
          .getRepository(Module)
          .findOne({ where: { isActive: true } });
        if (!module) throw new NotFoundException('No active module');

        const userRepository = manager.getRepository(User);
        const owner = await userRepository.findOne({
          where: { registrationNo: dto.registrationNo },
          withDeleted: true,
        });
        if (owner && owner.role !== UserRole.STUDENT) {
          throw new ConflictException(
            'Registration number belongs to an administrator',
          );
        }
        const emailOwner = await userRepository.findOne({
          where: { email: dto.email },
          withDeleted: true,
        });
        if (emailOwner && emailOwner.registrationNo !== dto.registrationNo) {
          throw new ConflictException('Email is already used by another user');
        }

        let studentId: string;
        let status: ImportStudentStatus;
        if (owner) {
          const enrolled = await manager.getRepository(Enrollment).findOne({
            where: { studentId: owner.id, moduleId: module.id },
          });
          if (enrolled) {
            throw new ConflictException(
              'Student is already enrolled in the active module',
            );
          }
          status = owner.deletedAt ? 'reactivated' : 'existing';
          await userRepository.update(
            { id: owner.id },
            { fullName: dto.fullName, email: dto.email, deletedAt: null },
          );
          studentId = owner.id;
        } else {
          passwordHash ??= await hash(dto.registrationNo, PASSWORD_HASH_COST);
          const created = await userRepository.save(
            userRepository.create({
              role: UserRole.STUDENT,
              registrationNo: dto.registrationNo,
              passwordHash,
              fullName: dto.fullName,
              email: dto.email,
              degreeProgram: null,
            }),
          );
          status = 'new';
          studentId = created.id;
        }

        await manager
          .getRepository(Enrollment)
          .insert({ studentId, moduleId: module.id });

        const auditRepository = manager.getRepository(AuditLog);
        await auditRepository.save(
          auditRepository.create({
            userId: actor.id,
            moduleId: module.id,
            action: 'module.student_added',
            affectedEntity: 'users',
            affectedRecordId: studentId,
            previousValue: owner
              ? {
                  fullName: owner.fullName,
                  email: owner.email,
                  deletedAt: owner.deletedAt,
                }
              : null,
            newValue: {
              status,
              registrationNo: dto.registrationNo,
              fullName: dto.fullName,
              email: dto.email,
            },
          }),
        );

        return {
          status,
          student: {
            id: studentId,
            registrationNo: dto.registrationNo,
            fullName: dto.fullName,
            email: dto.email,
          },
          module: { id: module.id, name: module.name },
        };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Data changed while adding the student; try again',
        );
      }
      throw error;
    }
  }

  /** Serializes activations, enrollments and grace changes of the active module. */
  private async lockModuleChanges(manager: EntityManager) {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [
      MODULE_ACTIVATION_LOCK_KEY,
    ]);
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === '23505'
    );
  }

  private async analyze(files: ImportFiles): Promise<ImportAnalysis> {
    const [studentSheet, scheduleSheet] = await Promise.all([
      readSheet(
        files.students,
        'students',
        STUDENT_COLUMNS,
        IMPORT_LIMITS.maxStudentRows,
      ),
      readSheet(
        files.schedules,
        'schedules',
        SCHEDULE_COLUMNS,
        IMPORT_LIMITS.maxScheduleRows,
      ),
    ]);
    const parsedStudents = parseStudents(studentSheet.rows);
    const parsedSchedules = parseSchedules(scheduleSheet.rows, this.today());

    const issues = [
      ...studentSheet.issues,
      ...parsedStudents.issues,
      ...scheduleSheet.issues,
      ...parsedSchedules.issues,
    ];
    const classified = await this.classifyStudents(
      parsedStudents.students,
      issues,
    );

    return {
      students: classified,
      schedules: parsedSchedules.schedules,
      issues,
      warnings: parsedSchedules.warnings,
    };
  }

  /**
   * Matches imported students with existing users (one query) and reports
   * conflicts: registration numbers owned by admins and emails owned by
   * someone else.
   */
  private async classifyStudents(
    students: ParsedStudent[],
    issues: ImportIssue[],
  ): Promise<ClassifiedStudent[]> {
    if (students.length === 0) return [];

    const existing = await this.users.find({
      where: [
        { registrationNo: In(students.map((s) => s.registrationNo)) },
        { email: In(students.map((s) => s.email)) },
      ],
      withDeleted: true,
    });
    const byRegistration = new Map(existing.map((u) => [u.registrationNo, u]));
    const byEmail = new Map(
      existing.filter((u) => u.email).map((u) => [u.email as string, u]),
    );

    const classified: ClassifiedStudent[] = [];
    for (const student of students) {
      const owner = byRegistration.get(student.registrationNo);
      const emailOwner = byEmail.get(student.email);
      let valid = true;

      if (owner && owner.role !== UserRole.STUDENT) {
        valid = false;
        issues.push({
          file: 'students',
          row: student.row,
          column: 'Número de registro',
          message: `El número de registro ${student.registrationNo} pertenece a un administrador.`,
        });
      }
      if (emailOwner && emailOwner.registrationNo !== student.registrationNo) {
        valid = false;
        issues.push({
          file: 'students',
          row: student.row,
          column: 'Correo electrónico',
          message: `El correo ${student.email} ya está registrado para otro usuario (registro ${emailOwner.registrationNo}).`,
        });
      }
      if (!valid) continue;

      classified.push({
        ...student,
        userId: owner?.id ?? null,
        status: !owner ? 'new' : owner.deletedAt ? 'reactivated' : 'existing',
        changed:
          !!owner &&
          (owner.fullName !== student.fullName ||
            owner.email !== student.email),
      });
    }
    return classified;
  }

  private issueReport(analysis: ImportAnalysis) {
    const fileOrder = { students: 0, schedules: 1 };
    const sorted = [...analysis.issues].sort(
      (a, b) =>
        fileOrder[a.file] - fileOrder[b.file] || (a.row ?? 0) - (b.row ?? 0),
    );
    return {
      issues: sorted.slice(0, IMPORT_LIMITS.maxReportedIssues),
      issuesTotal: sorted.length,
      warnings: analysis.warnings.slice(0, IMPORT_LIMITS.maxReportedIssues),
    };
  }

  private countByStatus(
    students: ClassifiedStudent[],
    status: ImportStudentStatus,
  ) {
    return students.filter((student) => student.status === status).length;
  }

  private chunk<T>(items: T[]): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += INSERT_CHUNK_SIZE) {
      chunks.push(items.slice(i, i + INSERT_CHUNK_SIZE));
    }
    return chunks;
  }

  /** Today's date (YYYY-MM-DD) in the institution's timezone. */
  private today(): string {
    const timeZone =
      this.configService.get<string>('APP_TIMEZONE') ?? DEFAULT_TIMEZONE;
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  }
}
