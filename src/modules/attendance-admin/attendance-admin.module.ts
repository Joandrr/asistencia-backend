import { Module } from '@nestjs/common';
import { AcademicModulesModule } from '../academic-modules/academic-modules.module';
import { AttendanceAdminController } from './attendance-admin.controller';
import { AttendanceAdminService } from './attendance-admin.service';

@Module({
  imports: [AcademicModulesModule],
  controllers: [AttendanceAdminController],
  providers: [AttendanceAdminService],
})
export class AttendanceAdminModule {}
