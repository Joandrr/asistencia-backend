import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from '../../database/entities/attendance.entity';
import { ClassSchedule } from '../../database/entities/class-schedule.entity';
import { Enrollment } from '../../database/entities/enrollment.entity';
import { Module as SubjectModule } from '../../database/entities/module.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { AcademicModulesModule } from '../academic-modules/academic-modules.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [
    AcademicModulesModule,
    TypeOrmModule.forFeature([
      Attendance,
      ClassSchedule,
      Enrollment,
      SubjectModule,
      User,
      AuditLog,
    ]),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
