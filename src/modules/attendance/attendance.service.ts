import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Attendance, AttendanceStatus } from '../../database/entities/attendance.entity';
import { ClassSchedule } from '../../database/entities/class-schedule.entity';
import { Enrollment } from '../../database/entities/enrollment.entity';
import { Module } from '../../database/entities/module.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(ClassSchedule)
    private readonly scheduleRepo: Repository<ClassSchedule>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Module)
    private readonly moduleRepo: Repository<Module>,
    private readonly dataSource: DataSource,
  ) {}

  private getBoliviaDateTime(): { date: string; time: string; full: Date } {
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/La_Paz',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    return { date, time, full: now };
  }

  async getTodayClasses(studentId: string) {
    const { date: todayDate, time: currentTime } = this.getBoliviaDateTime();

    const enrollments = await this.enrollmentRepo.find({
      where: { studentId },
      relations: { module: true },
    });

    if (enrollments.length === 0) {
      return {
        currentDate: todayDate,
        currentTime,
        classes: [],
      };
    }

    const moduleMap = new Map(enrollments.map((e) => [e.moduleId, e]));
    const moduleIds = enrollments.map((e) => e.moduleId);

    const schedules = await this.scheduleRepo
      .createQueryBuilder('schedule')
      .where('schedule.moduleId IN (:...moduleIds)', { moduleIds })
      .andWhere('schedule.classDate = :todayDate', { todayDate })
      .orderBy('schedule.startTime', 'ASC')
      .getMany();

    const scheduleIds = schedules.map((s) => s.id);
    const attendances = scheduleIds.length > 0
      ? await this.attendanceRepo
          .createQueryBuilder('att')
          .where('att.scheduleId IN (:...scheduleIds)', { scheduleIds })
          .andWhere('att.enrollmentId IN (:...enrollmentIds)', {
            enrollmentIds: enrollments.map((e) => e.id),
          })
          .getMany()
      : [];

    const attendanceMap = new Map(
      attendances.map((a) => [`${a.enrollmentId}_${a.scheduleId}`, a]),
    );

    const classes = schedules.map((schedule) => {
      const enrollment = moduleMap.get(schedule.moduleId)!;
      const attendance = attendanceMap.get(`${enrollment.id}_${schedule.id}`) || null;

      const isClassTime =
        currentTime >= schedule.startTime && currentTime <= schedule.endTime;
      const isPast = currentTime > schedule.endTime;
      const isFuture = currentTime < schedule.startTime;
      const hasMarked = Boolean(attendance);
      const canMark = isClassTime && !hasMarked;

      let statusMessage = 'Disponible para marcar';
      if (hasMarked) {
        statusMessage =
          attendance?.status === AttendanceStatus.PRESENT
            ? 'Asistencia registrada (Puntual)'
            : 'Asistencia registrada (Atraso)';
      } else if (isFuture) {
        statusMessage = `La clase inicia a las ${schedule.startTime.slice(0, 5)}`;
      } else if (isPast) {
        statusMessage = 'El horario de la clase ha finalizado';
      }

      return {
        scheduleId: schedule.id,
        enrollmentId: enrollment.id,
        moduleId: schedule.moduleId,
        moduleName: enrollment.module?.name ?? 'Materia',
        classDate: schedule.classDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        graceTime: schedule.graceTime,
        currentTime,
        isClassTime,
        isPast,
        isFuture,
        hasMarked,
        canMark,
        statusMessage,
        attendance: attendance
          ? {
              id: attendance.id,
              status: attendance.status,
              markedAt: attendance.markedAt,
              notes: attendance.notes,
            }
          : null,
      };
    });

    return {
      currentDate: todayDate,
      currentTime,
      classes,
    };
  }

  async markAttendance(studentId: string, scheduleId: string) {
    const { date: todayDate, time: currentTime, full: realTimestamp } =
      this.getBoliviaDateTime();

    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId },
      relations: { module: true },
    });

    if (!schedule) {
      throw new NotFoundException('La clase programada no fue encontrada');
    }

    const enrollment = await this.enrollmentRepo.findOne({
      where: {
        studentId,
        moduleId: schedule.moduleId,
      },
    });

    if (!enrollment) {
      throw new ForbiddenException(
        'El estudiante no se encuentra inscrito en este módulo/materia',
      );
    }

    const existingAttendance = await this.attendanceRepo.findOne({
      where: {
        enrollmentId: enrollment.id,
        scheduleId: schedule.id,
      },
    });

    if (existingAttendance) {
      throw new ConflictException(
        'Solo se admite una marca de asistencia por estudiante y fecha de clase',
      );
    }

    if (schedule.classDate !== todayDate) {
      throw new BadRequestException(
        `Fuera de la fecha programada. La clase corresponde a la fecha ${schedule.classDate}.`,
      );
    }

    if (currentTime < schedule.startTime) {
      throw new BadRequestException(
        `La clase aún no ha iniciado. Horario de inicio: ${schedule.startTime}`,
      );
    }

    if (currentTime > schedule.endTime) {
      throw new BadRequestException(
        `El horario de clase ha concluido. Horario de fin: ${schedule.endTime}`,
      );
    }

    const status =
      currentTime <= schedule.graceTime
        ? AttendanceStatus.PRESENT
        : AttendanceStatus.LATE;

    return await this.dataSource.transaction(async (manager) => {
      const attRepo = manager.getRepository(Attendance);
      const auditRepo = manager.getRepository(AuditLog);

      const record = attRepo.create({
        enrollmentId: enrollment.id,
        scheduleId: schedule.id,
        status,
        markedAt: realTimestamp,
        notes: `Marcado automáticamente (${status === AttendanceStatus.PRESENT ? 'Puntual' : 'Atraso'}) a las ${currentTime}`,
      });

      const savedAttendance = await attRepo.save(record);

      await auditRepo.save(
        auditRepo.create({
          userId: studentId,
          moduleId: schedule.moduleId,
          action: 'attendance.marked',
          affectedEntity: 'attendance',
          affectedRecordId: savedAttendance.id,
          previousValue: null,
          newValue: {
            id: savedAttendance.id,
            enrollmentId: enrollment.id,
            scheduleId: schedule.id,
            status,
            markedAt: realTimestamp,
          },
        }),
      );

      return {
        message:
          status === AttendanceStatus.PRESENT
            ? 'Asistencia marcada con éxito (Puntual)'
            : 'Asistencia marcada con éxito (Con retraso)',
        attendance: savedAttendance,
      };
    });
  }

  async getHistory(studentId: string, filterModuleId?: string) {
    const { date: todayDate, time: currentTime } = this.getBoliviaDateTime();

    const enrollments = await this.enrollmentRepo.find({
      where: { studentId },
      relations: { module: true },
    });

    if (enrollments.length === 0) {
      return { modules: [] };
    }

    const filteredEnrollments = filterModuleId
      ? enrollments.filter((e) => e.moduleId === filterModuleId)
      : enrollments;

    const results: any[] = [];

    for (const enrollment of filteredEnrollments) {
      const schedules = await this.scheduleRepo.find({
        where: { moduleId: enrollment.moduleId },
        order: { classDate: 'DESC', startTime: 'DESC' },
      });

      const scheduleIds = schedules.map((s) => s.id);
      const attendances = scheduleIds.length > 0
        ? await this.attendanceRepo
            .createQueryBuilder('att')
            .where('att.scheduleId IN (:...scheduleIds)', { scheduleIds })
            .andWhere('att.enrollmentId = :enrollmentId', {
              enrollmentId: enrollment.id,
            })
            .getMany()
        : [];

      const attMap = new Map(attendances.map((a) => [a.scheduleId, a]));

      let presentCount = 0;
      let lateCount = 0;
      let absentCount = 0;
      let pendingCount = 0;

      const historyClasses = schedules.map((schedule) => {
        const att = attMap.get(schedule.id) || null;
        let finalStatus: string;

        if (att) {
          finalStatus = att.status;
          if (att.status === AttendanceStatus.PRESENT) presentCount++;
          else if (att.status === AttendanceStatus.LATE) lateCount++;
          else if (att.status === AttendanceStatus.EXCUSED) presentCount++;
          else absentCount++;
        } else {
          const isPassed =
            schedule.classDate < todayDate ||
            (schedule.classDate === todayDate && currentTime > schedule.endTime);

          if (isPassed) {
            finalStatus = 'absent';
            absentCount++;
          } else {
            finalStatus = 'pending';
            pendingCount++;
          }
        }

        return {
          scheduleId: schedule.id,
          classDate: schedule.classDate,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          graceTime: schedule.graceTime,
          status: finalStatus,
          markedAt: att?.markedAt ?? null,
          notes: att?.notes ?? null,
        };
      });

      const evaluatedTotal = presentCount + lateCount + absentCount;
      const percentage = evaluatedTotal > 0
        ? Math.round(((presentCount + lateCount) / evaluatedTotal) * 100)
        : 100;

      results.push({
        moduleId: enrollment.moduleId,
        moduleName: enrollment.module?.name ?? 'Materia',
        stats: {
          totalSchedules: schedules.length,
          evaluatedTotal,
          presentCount,
          lateCount,
          absentCount,
          pendingCount,
          attendancePercentage: percentage,
        },
        records: historyClasses,
      });
    }

    return { modules: results };
  }

  async adminCorrectAttendance(
    adminId: string,
    studentId: string,
    scheduleId: string,
    status: AttendanceStatus,
    notes?: string,
  ) {
    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId },
      relations: { module: true },
    });

    if (!schedule) {
      throw new NotFoundException('La clase programada no fue encontrada');
    }

    const enrollment = await this.enrollmentRepo.findOne({
      where: {
        studentId,
        moduleId: schedule.moduleId,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        'El estudiante no está inscrito en este módulo/materia',
      );
    }

    const existing = await this.attendanceRepo.findOne({
      where: {
        enrollmentId: enrollment.id,
        scheduleId: schedule.id,
      },
    });

    const previousStatus = existing?.status ?? null;
    const realTimestamp = new Date();

    return await this.dataSource.transaction(async (manager) => {
      const attRepo = manager.getRepository(Attendance);
      const auditRepo = manager.getRepository(AuditLog);

      let record: Attendance;
      if (existing) {
        existing.status = status;
        existing.markedAt = existing.markedAt ?? realTimestamp;
        existing.notes = notes ?? `Corregido administrativamente fuera de fecha por admin #${adminId}`;
        record = await attRepo.save(existing);
      } else {
        record = await attRepo.save(
          attRepo.create({
            enrollmentId: enrollment.id,
            scheduleId: schedule.id,
            status,
            markedAt: realTimestamp,
            notes: notes ?? `Registrado administrativamente fuera de fecha por admin #${adminId}`,
          }),
        );
      }

      await auditRepo.save(
        auditRepo.create({
          userId: adminId,
          moduleId: schedule.moduleId,
          action: 'attendance.admin_corrected',
          affectedEntity: 'attendance',
          affectedRecordId: record.id,
          previousValue: previousStatus ? { status: previousStatus } : null,
          newValue: { status: record.status, notes: record.notes },
        }),
      );

      return {
        message: 'Asistencia corregida exitosamente por el administrador',
        attendance: record,
      };
    });
  }
}
