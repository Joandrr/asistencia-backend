import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AttendanceStatus } from '../../../database/entities/attendance.entity';

export class AdminCorrectAttendanceDto {
  @ApiProperty({ description: 'ID del estudiante', example: '4' })
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  @ApiProperty({ description: 'ID de la clase programada', example: '1' })
  @IsString()
  @IsNotEmpty()
  scheduleId!: string;

  @ApiProperty({
    description: 'Estado de la asistencia',
    enum: AttendanceStatus,
    example: AttendanceStatus.PRESENT,
  })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @ApiPropertyOptional({
    description: 'Motivo o justificación de la corrección fuera de fecha',
    example: 'Justificación médica presentada en secretaría',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
