import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { NUMERIC_ID_PATTERN } from '../../../common/numeric-id';
import { ListModuleStudentsDto } from './list-module-students.dto';

export class AttendanceByDateDto extends ListModuleStudentsDto {
  @ApiProperty({
    description: 'Class schedule id of the active module',
    example: '12',
  })
  @Matches(NUMERIC_ID_PATTERN, {
    message: 'scheduleId must be a positive integer',
  })
  scheduleId!: string;
}
