import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  attendanceRate,
  EffectiveStatus,
  effectiveStatusSql,
} from '../../common/attendance-status';
import { DEFAULT_TIMEZONE, LocalNow, nowInTimezone } from '../../common/clock';
import { Module } from '../../database/entities/module.entity';
import { AcademicModulesService } from '../academic-modules/academic-modules.service';
import { buildAttendanceWorkbook } from './attendance-export';
import { AttendanceByDateDto } from './dto/attendance-by-date.dto';
import { ListModuleStudentsDto } from './dto/list-module-students.dto';

export interface CountRow {
  present: number;
  late: number;
  absent: number;
  pending: number;
}

export interface StatusTotals extends CountRow {
  /** (present + late) / (present + late + absent); null when nothing was evaluated. */
  rate: number | null;
}

export interface ScheduleRow extends CountRow {
  id: string;
  classDate: string;
  startTime: string;
  endTime: string;
  editable: boolean;
}

export interface StudentRow extends CountRow {
  id: string;
  registrationNo: string;
  fullName: string | null;
  email: string | null;
}

// Positional parameters shared by every query: $1 module, $2 today, $3 now.
const STATUS = effectiveStatusSql('a', 's', '$2', '$3');
const ACTIVE_STUDENT_JOIN = `JOIN "users" u ON u."id" = e."student_id"
  AND u."deleted_at" IS NULL AND u."role" = 'student'`;
const SEARCH_FILTER = (param: string) => `(${param}::text IS NULL
  OR u."registration_no" ILIKE ${param} ESCAPE '\\'
  OR u."full_name" ILIKE ${param} ESCAPE '\\')`;
const STATUS_COUNTS = `
  COUNT(c.st) FILTER (WHERE c.st = 'present')::int AS "present",
  COUNT(c.st) FILTER (WHERE c.st = 'late')::int AS "late",
  COUNT(c.st) FILTER (WHERE c.st = 'absent')::int AS "absent",
  COUNT(c.st) FILTER (WHERE c.st = 'pending')::int AS "pending"`;
const STUDENT_ORDER = `u."full_name" ASC NULLS LAST, u."registration_no" ASC`;

@Injectable()
export class AttendanceAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly academicModules: AcademicModulesService,
    private readonly configService: ConfigService,
  ) {}

  /** RF-06: students of the active module with their attendance totals. */
  async listStudents(query: ListModuleStudentsDto) {
    const { module, now } = await this.context();
    const search = this.searchPattern(query.q);
    const offset = (query.page - 1) * query.limit;

    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query<StudentRow[]>(
        `SELECT u."id", u."registration_no" AS "registrationNo",
                u."full_name" AS "fullName", u."email", ${STATUS_COUNTS}
         FROM "enrollments" e
         ${ACTIVE_STUDENT_JOIN}
         LEFT JOIN LATERAL (
           SELECT ${STATUS} AS st
           FROM "class_schedules" s
           LEFT JOIN "attendance" a ON a."enrollment_id" = e."id"
             AND a."schedule_id" = s."id" AND a."deleted_at" IS NULL
           WHERE s."module_id" = e."module_id" AND s."deleted_at" IS NULL
         ) c ON TRUE
         WHERE e."module_id" = $1 AND e."deleted_at" IS NULL
           AND ${SEARCH_FILTER('$4')}
         GROUP BY u."id"
         ORDER BY ${STUDENT_ORDER}
         LIMIT $5 OFFSET $6`,
        [module.id, now.date, now.time, search, query.limit, offset],
      ),
      this.countStudents(module.id, search),
    ]);

    return {
      module: this.moduleInfo(module),
      data: rows.map((row) => ({
        ...row,
        rate: this.rate(row),
      })),
      meta: this.pageMeta(query, total),
    };
  }

  /** Module totals plus per-date totals (feeds the overview and the date filter). */
  async getSummary() {
    const { module, now } = await this.context();
    const [schedules, [{ total: students }]] = await Promise.all([
      this.scheduleTotals(module.id, now),
      this.countStudents(module.id, null),
    ]);

    return {
      module: this.moduleInfo(module),
      today: now.date,
      totals: {
        students,
        schedules: schedules.length,
        ...this.totals(schedules),
      },
      schedules: schedules.map((schedule) => ({
        ...schedule,
        rate: this.rate(schedule),
      })),
    };
  }

  /** RF-08: every student's status on one class date. */
  async getByDate(query: AttendanceByDateDto) {
    const { module, now } = await this.context();
    const [schedule] = await this.dataSource.query<
      Omit<ScheduleRow, keyof CountRow>[]
    >(
      `SELECT s."id", TO_CHAR(s."class_date", 'YYYY-MM-DD') AS "classDate",
              TO_CHAR(s."start_time", 'HH24:MI') AS "startTime",
              TO_CHAR(s."end_time", 'HH24:MI') AS "endTime",
              (s."class_date" <= $2::date) AS "editable"
       FROM "class_schedules" s
       WHERE s."id" = $3 AND s."module_id" = $1 AND s."deleted_at" IS NULL`,
      [module.id, now.date, query.scheduleId],
    );
    if (!schedule) {
      throw new NotFoundException('Class date not found in the active module');
    }

    const search = this.searchPattern(query.q);
    const offset = (query.page - 1) * query.limit;
    const [rows, [{ total }], totals] = await Promise.all([
      this.dataSource.query<
        Array<{
          studentId: string;
          registrationNo: string;
          fullName: string | null;
          email: string | null;
          status: EffectiveStatus;
          markedAt: Date | null;
        }>
      >(
        `SELECT u."id" AS "studentId", u."registration_no" AS "registrationNo",
                u."full_name" AS "fullName", u."email",
                ${STATUS} AS "status", a."marked_at" AS "markedAt"
         FROM "enrollments" e
         ${ACTIVE_STUDENT_JOIN}
         JOIN "class_schedules" s ON s."id" = $4
         LEFT JOIN "attendance" a ON a."enrollment_id" = e."id"
           AND a."schedule_id" = s."id" AND a."deleted_at" IS NULL
         WHERE e."module_id" = $1 AND e."deleted_at" IS NULL
           AND ${SEARCH_FILTER('$5')}
         ORDER BY ${STUDENT_ORDER}
         LIMIT $6 OFFSET $7`,
        [
          module.id,
          now.date,
          now.time,
          schedule.id,
          search,
          query.limit,
          offset,
        ],
      ),
      this.countStudents(module.id, search),
      this.scheduleTotals(module.id, now, schedule.id),
    ]);

    return {
      module: this.moduleInfo(module),
      schedule,
      totals: this.totals(totals),
      data: rows,
      meta: this.pageMeta(query, total),
    };
  }

  /** RF-08: one student's status on every class date of the active module. */
  async getByStudent(studentId: string) {
    const { module, now } = await this.context();
    const [student] = await this.dataSource.query<
      Array<{
        id: string;
        enrollmentId: string;
        registrationNo: string;
        fullName: string | null;
        email: string | null;
      }>
    >(
      `SELECT u."id", e."id" AS "enrollmentId",
              u."registration_no" AS "registrationNo",
              u."full_name" AS "fullName", u."email"
       FROM "enrollments" e
       ${ACTIVE_STUDENT_JOIN}
       WHERE e."module_id" = $1 AND e."student_id" = $2 AND e."deleted_at" IS NULL`,
      [module.id, studentId],
    );
    if (!student) {
      throw new NotFoundException('Student not found in the active module');
    }

    const records = await this.dataSource.query<
      Array<{
        scheduleId: string;
        classDate: string;
        startTime: string;
        endTime: string;
        editable: boolean;
        status: EffectiveStatus;
        markedAt: Date | null;
      }>
    >(
      `SELECT s."id" AS "scheduleId",
              TO_CHAR(s."class_date", 'YYYY-MM-DD') AS "classDate",
              TO_CHAR(s."start_time", 'HH24:MI') AS "startTime",
              TO_CHAR(s."end_time", 'HH24:MI') AS "endTime",
              (s."class_date" <= $2::date) AS "editable",
              ${STATUS} AS "status", a."marked_at" AS "markedAt"
       FROM "class_schedules" s
       LEFT JOIN "attendance" a ON a."enrollment_id" = $4
         AND a."schedule_id" = s."id" AND a."deleted_at" IS NULL
       WHERE s."module_id" = $1 AND s."deleted_at" IS NULL
       ORDER BY s."class_date" ASC`,
      [module.id, now.date, now.time, student.enrollmentId],
    );

    const counts: CountRow = { present: 0, late: 0, absent: 0, pending: 0 };
    for (const record of records) counts[record.status] += 1;

    return {
      module: this.moduleInfo(module),
      student: {
        id: student.id,
        registrationNo: student.registrationNo,
        fullName: student.fullName,
        email: student.email,
      },
      totals: {
        ...counts,
        rate: this.rate(counts),
      },
      records,
    };
  }

  /** RF-17: active module attendance as an Excel workbook. */
  async exportWorkbook() {
    const { module, now } = await this.context();
    const [students, schedules, cells] = await Promise.all([
      this.dataSource.query<StudentRow[]>(
        `SELECT u."id", u."registration_no" AS "registrationNo",
                u."full_name" AS "fullName", u."email", ${STATUS_COUNTS}
         FROM "enrollments" e
         ${ACTIVE_STUDENT_JOIN}
         LEFT JOIN LATERAL (
           SELECT ${STATUS} AS st
           FROM "class_schedules" s
           LEFT JOIN "attendance" a ON a."enrollment_id" = e."id"
             AND a."schedule_id" = s."id" AND a."deleted_at" IS NULL
           WHERE s."module_id" = e."module_id" AND s."deleted_at" IS NULL
         ) c ON TRUE
         WHERE e."module_id" = $1 AND e."deleted_at" IS NULL
         GROUP BY u."id"
         ORDER BY ${STUDENT_ORDER}`,
        [module.id, now.date, now.time],
      ),
      this.scheduleTotals(module.id, now),
      this.dataSource.query<
        Array<{
          studentId: string;
          scheduleId: string;
          status: EffectiveStatus;
        }>
      >(
        `SELECT e."student_id" AS "studentId", s."id" AS "scheduleId",
                ${STATUS} AS "status"
         FROM "enrollments" e
         ${ACTIVE_STUDENT_JOIN}
         JOIN "class_schedules" s ON s."module_id" = e."module_id"
           AND s."deleted_at" IS NULL
         LEFT JOIN "attendance" a ON a."enrollment_id" = e."id"
           AND a."schedule_id" = s."id" AND a."deleted_at" IS NULL
         WHERE e."module_id" = $1 AND e."deleted_at" IS NULL`,
        [module.id, now.date, now.time],
      ),
    ]);

    return buildAttendanceWorkbook({
      moduleName: module.name,
      graceMinutes: module.graceMinutes,
      generatedOn: now,
      students: students.map((row) => ({
        ...row,
        rate: this.rate(row),
      })),
      schedules,
      cells,
    });
  }

  private async context(): Promise<{ module: Module; now: LocalNow }> {
    const module = await this.academicModules.getActiveModule();
    if (!module) throw new NotFoundException('No active module');
    const timeZone =
      this.configService.get<string>('APP_TIMEZONE') ?? DEFAULT_TIMEZONE;
    return { module, now: nowInTimezone(timeZone) };
  }

  /** Per-date counts for the module, optionally for a single date. */
  private scheduleTotals(moduleId: string, now: LocalNow, scheduleId?: string) {
    return this.dataSource.query<ScheduleRow[]>(
      `SELECT s."id", TO_CHAR(s."class_date", 'YYYY-MM-DD') AS "classDate",
              TO_CHAR(s."start_time", 'HH24:MI') AS "startTime",
              TO_CHAR(s."end_time", 'HH24:MI') AS "endTime",
              (s."class_date" <= $2::date) AS "editable", ${STATUS_COUNTS}
       FROM "class_schedules" s
       LEFT JOIN LATERAL (
         SELECT ${STATUS} AS st
         FROM "enrollments" e
         ${ACTIVE_STUDENT_JOIN}
         LEFT JOIN "attendance" a ON a."enrollment_id" = e."id"
           AND a."schedule_id" = s."id" AND a."deleted_at" IS NULL
         WHERE e."module_id" = s."module_id" AND e."deleted_at" IS NULL
       ) c ON TRUE
       WHERE s."module_id" = $1 AND s."deleted_at" IS NULL
         AND ($4::bigint IS NULL OR s."id" = $4)
       GROUP BY s."id"
       ORDER BY s."class_date" ASC`,
      [moduleId, now.date, now.time, scheduleId ?? null],
    );
  }

  private countStudents(moduleId: string, search: string | null) {
    return this.dataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS "total"
       FROM "enrollments" e
       ${ACTIVE_STUDENT_JOIN}
       WHERE e."module_id" = $1 AND e."deleted_at" IS NULL
         AND ${SEARCH_FILTER('$2')}`,
      [moduleId, search],
    );
  }

  private totals(rows: CountRow[]): StatusTotals {
    const sum = rows.reduce(
      (acc, row) => ({
        present: acc.present + row.present,
        late: acc.late + row.late,
        absent: acc.absent + row.absent,
        pending: acc.pending + row.pending,
      }),
      { present: 0, late: 0, absent: 0, pending: 0 },
    );
    return { ...sum, rate: this.rate(sum) };
  }

  private rate(counts: CountRow) {
    return attendanceRate(counts.present, counts.late, counts.absent);
  }

  /** ILIKE pattern with %, _ and \ escaped so user input matches literally. */
  private searchPattern(q?: string): string | null {
    const term = q?.trim();
    return term ? `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  }

  private pageMeta(query: ListModuleStudentsDto, total: number) {
    return {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  private moduleInfo(module: Module) {
    return { id: module.id, name: module.name };
  }
}
