import * as ExcelJS from 'exceljs';
import { buildAttendanceWorkbook } from './attendance-export';

describe('attendance export workbook', () => {
  it('writes summary, detail grid and info sheets with matching numbers', async () => {
    const buffer = await buildAttendanceWorkbook({
      moduleName: 'Módulo 3',
      generatedOn: { date: '2026-10-14', time: '18:30:00' },
      students: [
        {
          id: '1',
          registrationNo: '0012345',
          fullName: '=CMD()',
          email: 'a@b.com',
          present: 1,
          absent: 1,
          pending: 1,
          rate: 50,
        },
        {
          id: '2',
          registrationNo: '7654321',
          fullName: 'Ana',
          email: null,
          present: 0,
          absent: 0,
          pending: 3,
          rate: null,
        },
      ],
      schedules: [
        {
          id: '10',
          classDate: '2026-10-12',
          startTime: '18:00',
          endTime: '21:00',
          present: 1,
          absent: 1,
        },
        {
          id: '11',
          classDate: '2026-10-13',
          startTime: '18:00',
          endTime: '21:00',
          present: 0,
          absent: 0,
        },
      ],
      cells: [
        { studentId: '1', scheduleId: '10', status: 'present' },
        { studentId: '1', scheduleId: '11', status: 'absent' },
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
    expect(summary.getRow(2).values).toEqual([
      undefined,
      '0012345',
      '=CMD()',
      'a@b.com',
      1,
      1,
      1,
      0.5,
    ]);
    expect(summary.getRow(3).getCell(7).value).toBeNull();
    // Names are stored as text, never as formulas.
    expect(summary.getRow(2).getCell(2).type).toBe(ExcelJS.ValueType.String);

    const detail = workbook.getWorksheet('Detalle por fecha')!;
    expect(detail.getRow(1).values).toEqual([
      undefined,
      'Número de registro',
      'Nombre completo',
      '12/10/2026',
      '13/10/2026',
    ]);
    expect(detail.getRow(2).values).toEqual([
      undefined,
      '0012345',
      '=CMD()',
      'Presente',
      'Falta',
    ]);
    // Missing cells default to pending.
    expect(detail.getRow(3).values).toEqual([
      undefined,
      '7654321',
      'Ana',
      'Falta',
      'Pendiente',
    ]);
    expect(detail.getRow(5).values).toEqual([
      undefined,
      '',
      'Total presentes',
      1,
      0,
    ]);
    expect(detail.getRow(6).values).toEqual([
      undefined,
      '',
      'Total faltas',
      1,
      0,
    ]);
  });
});
