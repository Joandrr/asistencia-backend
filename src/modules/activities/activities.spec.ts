import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { AcademicModulesService } from '../academic-modules/academic-modules.service';

describe('ActivitiesService & Controller', () => {
  let service: ActivitiesService;
  let controller: ActivitiesController;
  let dataSourceMock: Partial<DataSource>;
  let academicModulesMock: Partial<AcademicModulesService>;

  beforeEach(() => {
    dataSourceMock = {
      query: jest.fn(),
    };
    academicModulesMock = {
      getActiveModule: jest.fn(),
    };

    service = new ActivitiesService(
      dataSourceMock as DataSource,
      academicModulesMock as AcademicModulesService,
    );
    controller = new ActivitiesController(service);
  });

  it('throws NotFoundException when there is no active module', async () => {
    (academicModulesMock.getActiveModule as jest.Mock).mockResolvedValue(null);

    await expect(service.listActivities({})).rejects.toThrow(NotFoundException);
    await expect(service.getSummary()).rejects.toThrow(NotFoundException);
  });

  it('returns paginated activities for active module', async () => {
    (academicModulesMock.getActiveModule as jest.Mock).mockResolvedValue({
      id: '13',
      name: 'Modulo Sw2',
    });

    const mockRows = [
      {
        id: '35',
        createdAt: new Date('2026-10-14T04:38:57.762Z'),
        action: 'attendance.marked',
        affectedEntity: 'attendance',
        affectedRecordId: '35',
        previousValue: null,
        newValue: {
          id: '35',
          status: 'present',
          markedAt: '2026-10-14T04:38:57.547Z',
          scheduleId: '47',
          classDate: '2026-10-14',
          studentId: '9',
          registrationNo: '88000002',
          studentName: 'María López',
        },
        userId: '9',
        userName: 'María López',
        userRegistrationNo: '88000002',
        userRole: 'student',
        studentId: '9',
        studentName: 'María López',
        studentRegistrationNo: '88000002',
        classDate: '2026-10-14',
      },
    ];

    (dataSourceMock.query as jest.Mock)
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce(mockRows);

    const result = await controller.listActivities({ page: 1, limit: 15 });

    expect(result.module).toEqual({ id: '13', name: 'Modulo Sw2' });
    expect(result.meta).toEqual({
      page: 1,
      limit: 15,
      total: 1,
      totalPages: 1,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].actionLabel).toBe('Marca de asistencia');
    expect(result.data[0].student?.fullName).toBe('María López');
    expect(result.data[0].classDate).toBe('2026-10-14');
  });

  it('returns correct summary stats for active module', async () => {
    (academicModulesMock.getActiveModule as jest.Mock).mockResolvedValue({
      id: '13',
      name: 'Modulo Sw2',
    });

    (dataSourceMock.query as jest.Mock).mockResolvedValueOnce([
      { total: 35, marks: 28, corrections: 6, today: 5 },
    ]);

    const result = await controller.getSummary();

    expect(result.module).toEqual({ id: '13', name: 'Modulo Sw2' });
    expect(result.totals).toEqual({
      total: 35,
      marks: 28,
      corrections: 6,
      today: 5,
    });
  });
});
