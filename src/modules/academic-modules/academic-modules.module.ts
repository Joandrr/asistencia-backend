import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassSchedule } from '../../database/entities/class-schedule.entity';
import { Enrollment } from '../../database/entities/enrollment.entity';
import { Module as AcademicModule } from '../../database/entities/module.entity';
import { User } from '../users/entities/user.entity';
import { AcademicModulesController } from './academic-modules.controller';
import { AcademicModulesService } from './academic-modules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AcademicModule, ClassSchedule, Enrollment, User]),
  ],
  controllers: [AcademicModulesController],
  providers: [AcademicModulesService],
  // Exported so other features can scope their queries to the active module.
  exports: [AcademicModulesService],
})
export class AcademicModulesModule {}
