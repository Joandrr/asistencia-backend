import { AttendanceStatus } from '../database/entities/attendance.entity';
import { LocalNow } from './clock';

/** Attendance as shown to administrators: the requirements only use Present/Absent. */
export type EffectiveStatus = 'present' | 'absent' | 'pending';

const ATTENDED: ReadonlySet<string> = new Set([
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.EXCUSED,
]);

/**
 * A class without a mark counts as absent once it is over: any earlier date,
 * or today after its end time (same rule as the student history).
 */
export function isClassOver(
  classDate: string,
  endTime: string,
  now: LocalNow,
): boolean {
  return classDate < now.date || (classDate === now.date && endTime < now.time);
}

export function effectiveStatus(
  storedStatus: string | null,
  classDate: string,
  endTime: string,
  now: LocalNow,
): EffectiveStatus {
  if (storedStatus) return ATTENDED.has(storedStatus) ? 'present' : 'absent';
  return isClassOver(classDate, endTime, now) ? 'absent' : 'pending';
}

/**
 * SQL equivalent of effectiveStatus. `today` and `now` are the placeholders
 * (e.g. "$2", "$3") bound to LocalNow.date and LocalNow.time.
 */
export function effectiveStatusSql(
  attendanceAlias: string,
  scheduleAlias: string,
  today: string,
  now: string,
): string {
  const a = attendanceAlias;
  const s = scheduleAlias;
  return `CASE
    WHEN ${a}."status" IN ('present', 'late', 'excused') THEN 'present'
    WHEN ${a}."status" = 'absent' THEN 'absent'
    WHEN ${s}."class_date" < ${today}::date
      OR (${s}."class_date" = ${today}::date AND ${s}."end_time" < ${now}::time)
      THEN 'absent'
    ELSE 'pending'
  END`;
}

/** Attendance percentage over evaluated classes; null when none was evaluated yet. */
export function attendanceRate(present: number, absent: number): number | null {
  const evaluated = present + absent;
  return evaluated === 0 ? null : Math.round((present / evaluated) * 100);
}
