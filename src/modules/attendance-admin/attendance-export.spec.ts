import * as ExcelJS from 'exceljs';
import { buildAttendanceWorkbook } from './attendance-export';

describe('attendance export workbook', () => {
  it('writes summary, detail grid and info sheets with matching numbers', async () => {
    const buffer = await buildAttendanceWorkbook({
      moduleName: 'Módulo 3',
      graceMinutes: 10,
      generatedOn: { date: '2026-10-14', time: '18:30:00' },
      students: [
        {
          id: '1',
          registrationNo: '0012345',
          fullName: '=CMD()',
          email: 'a@b.com',
          present: 1,
          late: 1,
          absent: 1,
          pending: 0,
          rate: 67,
        },
        {
          id: '2',
          registrationNo: '7654321',
          fullName: 'Ana',
          email: null,
          present: 0,
          late: 0,
          absent: 1,
          pending: 2,
          rate: 0,
        },
      ],
      schedules: [
        {
          id: '10',
          classDate: '2026-10-12',
          startTime: '18:00',
          endTime: '21:00',
          present: 1,
          late: 0,
          absent: 1,
        },
        {
          id: '11',
          classDate: '2026-10-13',
          startTime: '18:00',
          endTime: '21:00',
          present: 0,
          late: 1,
          absent: 0,
        },
        {
          id: '12',
          classDate: '2026-10-20',
          startTime: '18:00',
          endTime: '21:00',
          present: 0,
          late: 0,
          absent: 1,
        },
      ],
      cells: [
        { studentId: '1', scheduleId: '10', status: 'present' },
        { studentId: '1', scheduleId: '11', status: 'late' },
        { studentId: '1', scheduleId: '12', status: 'absent' },
        { studentId: '2', scheduleId: '10', status: 'absent' },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumen',
      'Detalle por fecha',
      'Información',
    ]);

    const summary = workbook.getWorksheet('Resumen')!;
    expect(summary.getRow(1).values).toEqual([
      undefined,
      'Número de registro',
      'Nombre completo',
      'Correo electrónico',
      'Presentes',
      'Atrasos',
      'Faltas',
      'Pendientes',
      '% asistencia',
    ]);
    expect(summary.getRow(2).values).toEqual([
      undefined,
      '0012345',
      '=CMD()',
      'a@b.com',
      1,
      1,
      1,
      0,
      0.67,
    ]);
    // Names are stored as text, never as formulas.
    expect(summary.getRow(2).getCell(2).type).toBe(ExcelJS.ValueType.String);

    const detail = workbook.getWorksheet('Detalle por fecha')!;
    expect(detail.getRow(2).values).toEqual([
      undefined,
      '0012345',
      '=CMD()',
      'Presente',
      'Atraso',
      'Falta',
    ]);
    // Missing cells default to pending.
    expect(detail.getRow(3).values).toEqual([
      undefined,
      '7654321',
      'Ana',
      'Falta',
      'Pendiente',
      'Pendiente',
    ]);
    expect(detail.getRow(5).values).toEqual([
      undefined,
      '',
      'Total presentes',
      1,
      0,
      0,
    ]);
    expect(detail.getRow(6).values).toEqual([
      undefined,
      '',
      'Total atrasos',
      0,
      1,
      0,
    ]);
    expect(detail.getRow(7).values).toEqual([
      undefined,
      '',
      'Total faltas',
      1,
      0,
      1,
    ]);

    const info = workbook.getWorksheet('Información')!;
    const graceRow = info
      .getRows(1, info.rowCount)
      ?.find((row) => row.getCell(1).value === 'Tiempo de gracia');
    expect(graceRow?.getCell(2).value).toBe(
      '10 minutos desde la hora de inicio de cada clase.',
    );
  });
});
