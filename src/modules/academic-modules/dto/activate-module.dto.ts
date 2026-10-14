import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { DEFAULT_GRACE_MINUTES } from '../../../common/grace-period';
import { GraceMinutes } from './grace-minutes';

export class ActivateModuleDto {
  @ApiProperty({ example: 'Módulo 3 - Desarrollo Backend', maxLength: 150 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    enum: ['true'],
    description:
      'Explicit confirmation that the current module will be deactivated',
  })
  @IsIn(['true'])
  confirm!: 'true';

  @GraceMinutes()
  graceMinutes: number = DEFAULT_GRACE_MINUTES;
}
