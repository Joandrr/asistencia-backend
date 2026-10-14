import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'node:path';
import { IMPORT_LIMITS } from './excel/import-issue';
import { hasZipSignature } from './excel/zip-guard';

export const IMPORT_FILE_FIELDS = [
  { name: 'students', maxCount: 1 },
  { name: 'schedules', maxCount: 1 },
];

export interface ImportFiles {
  students: Buffer;
  schedules: Buffer;
}

export type UploadedImportFiles = Partial<
  Record<'students' | 'schedules', Express.Multer.File[]>
>;

const ACCEPTED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Some browsers/OSes send generic types for .xlsx; the content is verified later.
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
]);

export const XLSX_UPLOAD_OPTIONS: MulterOptions = {
  // No storage/dest: multer keeps files in memory (file.buffer), never on disk.
  limits: {
    fileSize: IMPORT_LIMITS.maxUploadBytes,
    files: 2,
    fields: 5,
    fieldSize: 1024,
    parts: 6,
  },
  fileFilter: (_request, file, callback) => {
    const isXlsx =
      extname(file.originalname).toLowerCase() === '.xlsx' &&
      ACCEPTED_MIME_TYPES.has(file.mimetype);
    if (!isXlsx) {
      callback(
        new BadRequestException(`${file.fieldname} must be an .xlsx file`),
        false,
      );
      return;
    }
    callback(null, true);
  },
};

/** Ensures both spreadsheets were sent and look like ZIP (.xlsx) archives. */
export function requireImportFiles(
  files: UploadedImportFiles | undefined,
): ImportFiles {
  const students = files?.students?.[0];
  const schedules = files?.schedules?.[0];
  if (!students || !schedules) {
    throw new BadRequestException(
      'Both students and schedules .xlsx files are required',
    );
  }
  for (const file of [students, schedules]) {
    if (!hasZipSignature(file.buffer)) {
      throw new BadRequestException(
        `${file.fieldname} is not a valid .xlsx file`,
      );
    }
  }
  return { students: students.buffer, schedules: schedules.buffer };
}
