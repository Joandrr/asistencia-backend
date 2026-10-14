export const DEFAULT_TIMEZONE = 'America/La_Paz';

export interface LocalNow {
  /** Calendar date in the institution's timezone, YYYY-MM-DD. */
  date: string;
  /** Wall-clock time in the institution's timezone, HH:mm:ss (24h). */
  time: string;
}

/** Current date and time in the given IANA timezone. */
export function nowInTimezone(
  timeZone = DEFAULT_TIMEZONE,
  now = new Date(),
): LocalNow {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return { date, time };
}
