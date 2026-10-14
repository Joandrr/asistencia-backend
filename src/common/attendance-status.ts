import { AttendanceStatus } from '../database/entities/attendance.entity';
import { LocalNow } from './clock';

/**
 * Attendance as shown to administrators. A late mark (after the module's
 * grace period) is its own state but still counts as attended.
 */
export type EffectiveStatus = 'present' | 'late' | 'absent' | 'pending';

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
  switch (storedStatus) {
    case AttendanceStatus.PRESENT:
    case AttendanceStatus.EXCUSED:
      return 'present';
    case AttendanceStatus.LATE:
      return 'late';
    case AttendanceStatus.ABSENT:
      return 'absent';
    default:
      return isClassOver(classDate, endTime, now) ? 'absent' : 'pending';
  }
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
    WHEN ${a}."status" IN ('present', 'excused') THEN 'present'
    WHEN ${a}."status" = 'late' THEN 'late'
    WHEN ${a}."status" = 'absent' THEN 'absent'
    WHEN ${s}."class_date" < ${today}::date
      OR (${s}."class_date" = ${today}::date AND ${s}."end_time" < ${now}::time)
      THEN 'absent'
    ELSE 'pending'
  END`;
}

/**
 * Attendance percentage over evaluated classes (late counts as attended);
 * null when none was evaluated yet.
 */
export function attendanceRate(
  present: number,
  late: number,
  absent: number,
): number | null {
  const attended = present + late;
  const evaluated = attended + absent;
  return evaluated === 0 ? null : Math.round((attended / evaluated) * 100);
}
