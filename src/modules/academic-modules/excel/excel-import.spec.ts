import * as ExcelJS from 'exceljs';
import { IMPORT_LIMITS } from './import-issue';
import {
  parseDate,
  parseSchedules,
  parseTime,
  SCHEDULE_COLUMNS,
} from './parse-schedules';
import { parseStudents, STUDENT_COLUMNS } from './parse-students';
import { readSheet } from './read-sheet';
import { buildTemplate } from './templates';
import { inspectZipArchive } from './zip-guard';

type CellFormats = Record<string, string>;

async function workbook(rows: unknown[][], formats: CellFormats = {}) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Hoja1');
  rows.forEach((row) => sheet.addRow(row));
  Object.entries(formats).forEach(([address, numFmt]) => {
    sheet.getCell(address).numFmt = numFmt;
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function readStudents(rows: unknown[][]) {
  const sheet = await readSheet(
    await workbook(rows),
    'students',
    STUDENT_COLUMNS,
    IMPORT_LIMITS.maxStudentRows,
  );
  return { sheet, ...parseStudents(sheet.rows) };
}

async function readSchedules(rows: unknown[][], formats?: CellFormats) {
  const sheet = await readSheet(
    await workbook(rows, formats),
    'schedules',
    SCHEDULE_COLUMNS,
    IMPORT_LIMITS.maxScheduleRows,
  );
  return { sheet, ...parseSchedules(sheet.rows, '2026-10-13') };
}

const STUDENT_HEADER = [
  'Número de registro',
  'Nombre completo',
  'Correo electrónico',
];
const SCHEDULE_HEADER = ['Fecha', 'Hora inicio', 'Hora fin'];

describe('student import', () => {
  it('parses valid rows, accepting headers without accents and mixed cell types', async () => {
    const { sheet, students, issues } = await readStudents([
      ['numero de REGISTRO', 'Nombre', 'Correo'],
      [
        1234567,
        { richText: [{ text: 'Juan ' }, { text: 'Pérez' }] },
        'JUAN@Gmail.com',
      ],
      [
        '00123456',
        '  María   López ',
        { text: 'maria@gmail.com', hyperlink: 'mailto:maria@gmail.com' },
      ],
      [{ formula: 'A2+1', result: 1234568 }, 'Ana Gómez', 'ana@gmail.com'],
      [null, null, null],
    ]);
    expect(sheet.issues).toEqual([]);
    expect(issues).toEqual([]);
    expect(students).toEqual([
      {
        row: 2,
        registrationNo: '1234567',
        fullName: 'Juan Pérez',
        email: 'juan@gmail.com',
      },
      {
        row: 3,
        registrationNo: '00123456',
        fullName: 'María López',
        email: 'maria@gmail.com',
      },
      {
        row: 4,
        registrationNo: '1234568',
        fullName: 'Ana Gómez',
        email: 'ana@gmail.com',
      },
    ]);
  });

  it('reports missing fields, invalid values and duplicates with their row', async () => {
    const { students, issues } = await readStudents([
      STUDENT_HEADER,
      [1001, 'Corto', 'corto@gmail.com'],
      [1234567.5, 'Decimal', 'decimal@gmail.com'],
      ['', '', 'sin-arroba'],
      [7654321, 'Uno', 'dup@gmail.com'],
      [7654321, 'Dos', 'DUP@gmail.com'],
      [1.5e12, '12345', 'otro@gmail.com'],
    ]);
    expect(students).toHaveLength(1);
    expect(students[0].registrationNo).toBe('7654321');
    const summary = issues.map((i) => `${i.row}:${i.column}`);
    expect(summary).toEqual([
      '2:Número de registro',
      '3:Número de registro',
      '4:Número de registro',
      '4:Nombre completo',
      '4:Correo electrónico',
      '6:Número de registro',
      '6:Correo electrónico',
      '7:Número de registro',
      '7:Nombre completo',
    ]);
    expect(issues[5].message).toContain('fila 5');
  });

  it('accepts registration numbers of 6 to 12 digits, like login', async () => {
    const { students, issues } = await readStudents([
      STUDENT_HEADER,
      ['123456', 'Seis Dígitos', 'seis@gmail.com'],
      ['12345', 'Cinco Dígitos', 'cinco@gmail.com'],
      ['123456789012', 'Doce Dígitos', 'doce@gmail.com'],
    ]);
    expect(students.map((s) => s.registrationNo)).toEqual([
      '123456',
      '123456789012',
    ]);
    expect(issues.map((i) => i.row)).toEqual([3]);
  });

  it('rejects files with missing or repeated headers', async () => {
    const missing = await readStudents([
      ['Registro', 'Nombre'],
      [1234567, 'Ana'],
    ]);
    expect(missing.sheet.issues[0].message).toContain('Correo electrónico');

    const repeated = await readStudents([
      ['Registro', 'Nombre', 'Correo', 'Email'],
      [1234567, 'Ana', 'a@b.com', 'a@b.com'],
    ]);
    expect(repeated.sheet.issues[0].message).toContain('repetidas');
  });

  it('reports empty files and files over the row limit', async () => {
    const empty = await readStudents([STUDENT_HEADER]);
    expect(empty.sheet.issues[0].message).toContain('no tiene filas');

    const rows = Array.from({ length: 4 }, (_, i) => [
      1000000 + i,
      'Ana',
      `a${i}@b.com`,
    ]);
    const sheet = await readSheet(
      await workbook([STUDENT_HEADER, ...rows]),
      'students',
      STUDENT_COLUMNS,
      3,
    );
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.issues[0].message).toContain('máximo de 3 filas');
  });

  it('rejects content that is not a valid xlsx archive', async () => {
    const result = await readSheet(
      Buffer.from('not a spreadsheet'),
      'students',
      STUDENT_COLUMNS,
      10,
    );
    expect(result.issues[0].message).toContain('no es un Excel');

    const fakeZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(64),
    ]);
    const corrupt = await readSheet(fakeZip, 'students', STUDENT_COLUMNS, 10);
    expect(corrupt.issues).toHaveLength(1);
  });
});

describe('schedule import', () => {
  it('parses dates and times from date cells, fractions and text', async () => {
    const { issues, warnings, schedules } = await readSchedules(
      [
        SCHEDULE_HEADER,
        ['07/11/2026', '18:00', '21:00'],
        [
          new Date(Date.UTC(2026, 10, 5)),
          0.7499999999,
          new Date(Date.UTC(1899, 11, 30, 21, 0)),
        ],
        [46336, '8:05', '10:30:00'],
      ],
      { A3: 'dd/mm/yyyy', B3: 'hh:mm', C3: 'hh:mm' },
    );
    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    expect(schedules).toEqual([
      { row: 3, classDate: '2026-11-05', startTime: '18:00', endTime: '21:00' },
      { row: 2, classDate: '2026-11-07', startTime: '18:00', endTime: '21:00' },
      { row: 4, classDate: '2026-11-10', startTime: '08:05', endTime: '10:30' },
    ]);
  });

  it('reports invalid dates, times, order and duplicates', async () => {
    const { issues, schedules } = await readSchedules([
      SCHEDULE_HEADER,
      ['31/02/2026', '18:00', '21:00'],
      ['05/12/2026', '25:00', '21:00'],
      ['06/12/2026', '21:00', '18:00'],
      ['07/12/2026', '18:00', '18:00'],
      ['08/12/2026', '', '21:00'],
      ['09/12/2026', '18:00', '21:00'],
      ['09/12/2026', '19:00', '22:00'],
    ]);
    expect(schedules.map((s) => s.classDate)).toEqual(['2026-12-09']);
    expect(issues.map((i) => `${i.row}:${i.column}`)).toEqual([
      '2:Fecha',
      '3:Hora inicio',
      '4:Hora fin',
      '5:Hora fin',
      '6:Hora inicio',
      '8:Fecha',
    ]);
  });

  it('warns (without failing) about past dates', async () => {
    const { issues, warnings, schedules } = await readSchedules([
      SCHEDULE_HEADER,
      ['05/10/2026', '18:00', '21:00'],
      ['13/10/2026', '18:00', '21:00'],
    ]);
    expect(issues).toEqual([]);
    expect(schedules).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].row).toBe(2);
  });

  it('validates single values', () => {
    expect(parseDate('29/02/2028')).toBe('2028-02-29');
    expect(parseDate('29/02/2027')).toBeNull();
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('05/10/1999')).toBeNull();
    expect(parseDate(46300.5)).toBeNull();
    expect(parseTime(0)).toBe(0);
    expect(parseTime(0.99999)).toBeNull(); // rounds to 24:00
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('7:60')).toBeNull();
    expect(parseTime('18h')).toBeNull();
  });
});

describe('templates and zip guard', () => {
  it('generates templates that the importer reads back without header errors', async () => {
    for (const [kind, columns] of [
      ['students', STUDENT_COLUMNS],
      ['schedules', SCHEDULE_COLUMNS],
    ] as const) {
      const buffer = await buildTemplate(kind);
      expect(inspectZipArchive(buffer)).toBeNull();
      const result = await readSheet(buffer, kind, [...columns], 10);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain('no tiene filas');
    }
  });

  it('rejects archives that declare an excessive uncompressed size', async () => {
    const buffer = await workbook([
      STUDENT_HEADER,
      [1234567, 'Ana', 'a@b.com'],
    ]);
    const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const directoryOffset = buffer.readUInt32LE(eocd + 16);
    const tampered = Buffer.from(buffer);
    tampered.writeUInt32LE(
      IMPORT_LIMITS.maxUncompressedBytes + 1,
      directoryOffset + 24,
    );
    expect(inspectZipArchive(tampered)).toBe('size');
  });
});
