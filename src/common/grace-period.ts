export const DEFAULT_GRACE_MINUTES = 10;
export const MAX_GRACE_MINUTES = 240;

/**
 * Last time (HH:mm) a mark counts as present: start + graceMinutes, never
 * past the end of the class (same rule as the SQL used when it is edited).
 */
export function graceTimeFor(
  startTime: string,
  endTime: string,
  graceMinutes: number,
): string {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const grace = Math.min(Math.max(0, Math.trunc(graceMinutes)), end - start);
  const total = start + Math.max(0, grace);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** SQL expression with the same rule; `minutes` is a placeholder such as "$2". */
export function graceTimeSql(scheduleAlias: string, minutes: string): string {
  const s = scheduleAlias;
  return `${s}."start_time" + LEAST(make_interval(mins => ${minutes}::int), ${s}."end_time" - ${s}."start_time")`;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
