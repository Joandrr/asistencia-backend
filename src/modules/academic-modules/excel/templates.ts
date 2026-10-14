import * as ExcelJS from 'exceljs';
import { IMPORT_LIMITS } from './import-issue';
import { STUDENT_COLUMNS } from './parse-students';
import { SCHEDULE_COLUMNS } from './parse-schedules';

export type TemplateKind = 'students' | 'schedules';

export const TEMPLATE_FILENAMES: Record<TemplateKind, string> = {
  students: 'plantilla-estudiantes.xlsx',
  schedules: 'plantilla-fechas.xlsx',
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A8A' },
};

/** Builds an empty template: header row plus a separate instructions sheet. */
export async function buildTemplate(kind: TemplateKind): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema de Control de Asistencia';
  const sheet = workbook.addWorksheet(
    kind === 'students' ? 'Estudiantes' : 'Fechas',
    { views: [{ state: 'frozen', ySplit: 1 }] },
  );

  if (kind === 'students') {
    sheet.columns = STUDENT_COLUMNS.map((column) => ({
      header: column.label,
      key: column.key,
      width: column.key === 'registrationNo' ? 22 : 36,
      // Text format keeps leading zeros in registration numbers.
      style: column.key === 'registrationNo' ? { numFmt: '@' } : {},
    }));
  } else {
    sheet.columns = SCHEDULE_COLUMNS.map((column) => ({
      header: column.label,
      key: column.key,
      width: 16,
      style: { numFmt: column.key === 'classDate' ? 'dd/mm/yyyy' : 'hh:mm' },
    }));
  }

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.numFmt = 'General';
  });

  const help = workbook.addWorksheet('Instrucciones');
  help.getColumn(1).width = 100;
  const lines =
    kind === 'students'
      ? [
          'Completa la hoja "Estudiantes" desde la fila 2, un estudiante por fila.',
          'Número de registro: entre 7 y 12 dígitos, sin espacios ni guiones. No se puede repetir.',
          'Nombre completo: obligatorio.',
          'Correo electrónico: obligatorio, con formato válido. No se puede repetir.',
          `Máximo ${IMPORT_LIMITS.maxStudentRows} estudiantes por archivo.`,
          'La contraseña inicial de los estudiantes nuevos es su número de registro.',
        ]
      : [
          'Completa la hoja "Fechas" desde la fila 2, una fecha de clase por fila.',
          'Fecha: formato dd/mm/aaaa. No se puede repetir.',
          'Hora inicio y Hora fin: formato HH:mm (24 horas). La hora de fin debe ser posterior a la de inicio.',
          'La asistencia se podrá marcar durante todo el día de cada fecha; los horarios son informativos.',
          `Máximo ${IMPORT_LIMITS.maxScheduleRows} fechas por archivo.`,
        ];
  lines.forEach((line) => help.addRow([line]));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
