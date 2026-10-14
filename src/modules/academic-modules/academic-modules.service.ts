import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
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
        studentsCount,
        schedulesCount,
        firstDate: range?.firstDate ?? null,
        lastDate: range?.lastDate ?? null,
      },
    };
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
  async activate(name: string, files: ImportFiles, actor: AuthenticatedUser) {
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
        await manager.query('SELECT pg_advisory_xact_lock($1)', [
          MODULE_ACTIVATION_LOCK_KEY,
        ]);

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
          moduleRepository.create({ name, isActive: true }),
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
                // RF-12: no lateness or tolerance in this version; grace_time is
                // required by the schema, so it spans the whole class.
                graceTime: schedule.endTime,
              })),
            )
            .execute();
        }

        const summary = {
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
