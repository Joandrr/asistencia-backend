import { isBlankCell, unwrapCell } from './cell-value';
import { ImportIssue } from './import-issue';
import { ColumnSpec, SheetRow } from './read-sheet';

export type ScheduleColumn = 'classDate' | 'startTime' | 'endTime';

export const SCHEDULE_COLUMNS: ColumnSpec<ScheduleColumn>[] = [
  { key: 'classDate', label: 'Fecha', aliases: ['fecha', 'fecha de clase'] },
  {
    key: 'startTime',
    label: 'Hora inicio',
    aliases: ['hora inicio', 'hora de inicio', 'inicio'],
  },
  {
    key: 'endTime',
    label: 'Hora fin',
    aliases: ['hora fin', 'hora de fin', 'hora final', 'fin'],
  },
];

export interface ParsedSchedule {
  row: number;
  /** ISO calendar date, YYYY-MM-DD. */
  classDate: string;
  /** 24h time, HH:mm. */
  startTime: string;
  endTime: string;
}

const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1440;
// Excel serial day 0 is 1899-12-30 (accounts for the 1900 leap-year bug).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;
const LABEL = Object.fromEntries(
  SCHEDULE_COLUMNS.map((column) => [column.key, column.label]),
) as Record<ScheduleColumn, string>;

export function parseSchedules(
  rows: SheetRow<ScheduleColumn>[],
  today: string,
): {
  schedules: ParsedSchedule[];
  issues: ImportIssue[];
  warnings: ImportIssue[];
} {
  const schedules: ParsedSchedule[] = [];
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const rowByDate = new Map<string, number>();

  for (const { row, values } of rows) {
    const issuesBefore = issues.length;
    const issue = (key: ScheduleColumn, message: string) =>
      issues.push({ file: 'schedules', row, column: LABEL[key], message });

    const classDate = isBlankCell(values.classDate)
      ? undefined
      : parseDate(values.classDate);
    const start = isBlankCell(values.startTime)
      ? undefined
      : parseTime(values.startTime);
    const end = isBlankCell(values.endTime)
      ? undefined
      : parseTime(values.endTime);

    if (classDate === undefined) issue('classDate', 'La fecha es obligatoria.');
    else if (classDate === null) {
      issue(
        'classDate',
        `La fecha no es válida. Usa el formato dd/mm/aaaa (entre ${MIN_YEAR} y ${MAX_YEAR}).`,
      );
    }
    if (start === undefined)
      issue('startTime', 'La hora de inicio es obligatoria.');
    else if (start === null)
      issue(
        'startTime',
        'La hora de inicio no es válida. Usa el formato HH:mm (24 horas).',
      );
    if (end === undefined) issue('endTime', 'La hora de fin es obligatoria.');
    else if (end === null)
      issue(
        'endTime',
        'La hora de fin no es válida. Usa el formato HH:mm (24 horas).',
      );

    if (typeof start === 'number' && typeof end === 'number' && end <= start) {
      issue(
        'endTime',
        'La hora de fin debe ser posterior a la hora de inicio.',
      );
    }

    if (classDate) {
      const firstRow = rowByDate.get(classDate);
      if (firstRow !== undefined) {
        issue(
          'classDate',
          `La fecha ${formatDisplayDate(classDate)} está repetida (ya aparece en la fila ${firstRow}).`,
        );
      } else {
        rowByDate.set(classDate, row);
      }
    }

    if (
      issues.length === issuesBefore &&
      classDate &&
      typeof start === 'number' &&
      typeof end === 'number'
    ) {
      if (classDate < today) {
        warnings.push({
          file: 'schedules',
          row,
          column: LABEL.classDate,
          message: `La fecha ${formatDisplayDate(classDate)} ya pasó; los estudiantes no podrán marcar asistencia en ella.`,
        });
      }
      schedules.push({
        row,
        classDate,
        startTime: formatMinutes(start),
        endTime: formatMinutes(end),
      });
    }
  }

  schedules.sort((a, b) => a.classDate.localeCompare(b.classDate));
  return { schedules, issues, warnings };
}

/** Returns YYYY-MM-DD, or null when the value is not a real calendar date. */
export function parseDate(raw: unknown): string | null {
  const value = unwrapCell(raw);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // exceljs builds dates in UTC; reading UTC parts avoids off-by-one days.
    return toIsoDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }
  if (typeof value === 'number') {
    // Date typed in a cell without date format: Excel serial day number.
    if (!Number.isInteger(value)) return null;
    const date = new Date(EXCEL_EPOCH_MS + value * MS_PER_DAY);
    return toIsoDate(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dayFirst) {
    return toIsoDate(
      Number(dayFirst[3]),
      Number(dayFirst[2]),
      Number(dayFirst[1]),
    );
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

/** Returns minutes since midnight (0-1439), or null when invalid. */
export function parseTime(raw: unknown): number | null {
  const value = unwrapCell(raw);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const msOfDay = ((value.getTime() % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
    return validMinutes(Math.round(msOfDay / 60_000));
  }
  if (typeof value === 'number') {
    // Excel stores times as a fraction of a day; round to the minute so
    // floating point noise (0.7499999) still means 18:00.
    if (value < 0 || value >= 1) return null;
    return validMinutes(Math.round(value * MINUTES_PER_DAY));
  }
  if (typeof value !== 'string') return null;

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes;
}

function validMinutes(minutes: number): number | null {
  return minutes >= 0 && minutes < MINUTES_PER_DAY ? minutes : null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // e.g. 31/02 rolls over to March
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
