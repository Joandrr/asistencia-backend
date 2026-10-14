export type ImportFile = 'students' | 'schedules';

/** A problem found in an uploaded spreadsheet, reported back to the admin. */
export interface ImportIssue {
  file: ImportFile;
  /** Spreadsheet row number (1-based); null for file-level problems. */
  row: number | null;
  /** Column label as shown in the template; null when not column-specific. */
  column: string | null;
  message: string;
}

export const IMPORT_LIMITS = {
  maxUploadBytes: 2 * 1024 * 1024,
  maxUncompressedBytes: 30 * 1024 * 1024,
  maxZipEntries: 500,
  maxStudentRows: 1000,
  maxScheduleRows: 366,
  maxReportedIssues: 200,
} as const;
