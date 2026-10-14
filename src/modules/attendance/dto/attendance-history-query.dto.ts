import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AttendanceHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrar historial por ID de materia (module_id)',
    example: '1',
  })
  @IsOptional()
  @IsString()
  moduleId?: string;
}
