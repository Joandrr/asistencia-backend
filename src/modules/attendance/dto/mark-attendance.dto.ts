import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MarkAttendanceDto {
  @ApiProperty({
    description: 'ID de la clase programada (class_schedule)',
    example: '1',
  })
  @IsString()
  @IsNotEmpty()
  scheduleId!: string;
}
