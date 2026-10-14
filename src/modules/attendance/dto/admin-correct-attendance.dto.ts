import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AttendanceStatus } from '../../../database/entities/attendance.entity';
import { NUMERIC_ID_PATTERN } from '../../../common/numeric-id';

/** States an administrator can set (late = marked after the grace period). */
export const CORRECTABLE_STATUSES = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.ABSENT,
] as const;
export type CorrectableStatus = (typeof CORRECTABLE_STATUSES)[number];

export class AdminCorrectAttendanceDto {
  @ApiProperty({ description: 'ID del estudiante', example: '4' })
  @Matches(NUMERIC_ID_PATTERN, {
    message: 'studentId must be a positive integer',
  })
  studentId!: string;

  @ApiProperty({ description: 'ID de la clase programada', example: '1' })
  @Matches(NUMERIC_ID_PATTERN, {
    message: 'scheduleId must be a positive integer',
  })
  scheduleId!: string;

  @ApiProperty({
    description: 'Estado de la asistencia',
    enum: CORRECTABLE_STATUSES,
    example: AttendanceStatus.PRESENT,
  })
  @IsIn(CORRECTABLE_STATUSES)
  status!: CorrectableStatus;

  @ApiPropertyOptional({
    description: 'Motivo de la corrección',
    example: 'Justificación médica presentada en secretaría',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
