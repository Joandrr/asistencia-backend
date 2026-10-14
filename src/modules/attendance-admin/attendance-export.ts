import * as ExcelJS from 'exceljs';
import { EffectiveStatus } from '../../common/attendance-status';
import { LocalNow } from '../../common/clock';
import {
  styleHeaderRow,
  WORKBOOK_CREATOR,
} from '../academic-modules/excel/templates';

export interface ExportStudent {
  id: string;
  registrationNo: string;
  fullName: string | null;
  email: string | null;
  present: number;
  absent: number;
  pending: number;
  rate: number | null;
}

export interface ExportSchedule {
  id: string;
  classDate: string;
  startTime: string;
  endTime: string;
  present: number;
  absent: number;
}

export interface ExportInput {
  moduleName: string;
  generatedOn: LocalNow;
  students: ExportStudent[];
  schedules: ExportSchedule[];
  cells: Array<{
    studentId: string;
    scheduleId: string;
    status: EffectiveStatus;
  }>;
}

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  present: 'Presente',
  absent: 'Falta',
  pending: 'Pendiente',
};

const STATUS_FILL: Record<EffectiveStatus, string> = {
  present: 'FFDCFCE7',
  absent: 'FFFEE2E2',
  pending: 'FFF1F5F9',
};

/** Builds the attendance export: summary per student and a student × date grid. */
export async function buildAttendanceWorkbook(
  input: ExportInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = WORKBOOK_CREATOR;
  addSummarySheet(workbook, input);
  addDetailSheet(workbook, input);
  addInfoSheet(workbook, input);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addSummarySheet(workbook: ExcelJS.Workbook, input: ExportInput) {
  const sheet = workbook.addWorksheet('Resumen', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    {
      header: 'Número de registro',
      key: 'registrationNo',
      width: 20,
      style: { numFmt: '@' },
    },
    { header: 'Nombre completo', key: 'fullName', width: 34 },
    { header: 'Correo electrónico', key: 'email', width: 32 },
    { header: 'Presentes', key: 'present', width: 12 },
    { header: 'Faltas', key: 'absent', width: 12 },
    { header: 'Pendientes', key: 'pending', width: 12 },
    { header: '% asistencia', key: 'rate', width: 14, style: { numFmt: '0%' } },
  ];
  styleHeaderRow(sheet.getRow(1));
  for (const student of input.students) {
    sheet.addRow({
      registrationNo: student.registrationNo,
      fullName: student.fullName ?? '',
      email: student.email ?? '',
      present: student.present,
      absent: student.absent,
      pending: student.pending,
      // Stored as a fraction so Excel shows and sorts it as a real percentage.
      rate: student.rate === null ? null : student.rate / 100,
    });
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
}

function addDetailSheet(workbook: ExcelJS.Workbook, input: ExportInput) {
  const sheet = workbook.addWorksheet('Detalle por fecha', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });
  sheet.columns = [
    {
      header: 'Número de registro',
      key: 'registrationNo',
      width: 20,
      style: { numFmt: '@' },
    },
    { header: 'Nombre completo', key: 'fullName', width: 34 },
    ...input.schedules.map((schedule) => ({
      header: formatDate(schedule.classDate),
      key: schedule.id,
      width: 12,
    })),
  ];
  styleHeaderRow(sheet.getRow(1));

  const statusByCell = new Map(
    input.cells.map((cell) => [
      `${cell.studentId}:${cell.scheduleId}`,
      cell.status,
    ]),
  );
  for (const student of input.students) {
    const row = sheet.addRow([student.registrationNo, student.fullName ?? '']);
    input.schedules.forEach((schedule, index) => {
      const status =
        statusByCell.get(`${student.id}:${schedule.id}`) ?? 'pending';
      const cell = row.getCell(index + 3);
      cell.value = STATUS_LABEL[status];
      cell.alignment = { horizontal: 'center' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: STATUS_FILL[status] },
      };
    });
  }

  if (input.schedules.length > 0) {
    sheet.addRow([]);
    for (const [label, key] of [
      ['Total presentes', 'present'],
      ['Total faltas', 'absent'],
    ] as const) {
      const row = sheet.addRow([
        '',
        label,
        ...input.schedules.map((schedule) => schedule[key]),
      ]);
      row.font = { bold: true };
    }
  }
}

function addInfoSheet(workbook: ExcelJS.Workbook, input: ExportInput) {
  const sheet = workbook.addWorksheet('Información');
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 80;
  const rows: Array<[string, string]> = [
    ['Módulo', input.moduleName],
    [
      'Generado',
      `${formatDate(input.generatedOn.date)} ${input.generatedOn.time.slice(0, 5)}`,
    ],
    ['Estudiantes', String(input.students.length)],
    ['Fechas de clase', String(input.schedules.length)],
    [
      'Presente',
      'Asistencia registrada (incluye marcas con atraso o justificadas).',
    ],
    [
      'Falta',
      'Sin marca cuando la clase ya terminó, o falta registrada por el administrador.',
    ],
    ['Pendiente', 'Clase que aún no termina y todavía no tiene marca.'],
    [
      '% asistencia',
      'Presentes / (Presentes + Faltas). Las clases pendientes no se cuentan.',
    ],
  ];
  rows.forEach(([label, value]) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  });
}

function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}
