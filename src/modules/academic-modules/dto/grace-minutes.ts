import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import {
  DEFAULT_GRACE_MINUTES,
  MAX_GRACE_MINUTES,
} from '../../../common/grace-period';

/** Whole minutes (0-240) after the start time that still count as present. */
export function GraceMinutes() {
  return applyDecorators(
    ApiProperty({
      minimum: 0,
      maximum: MAX_GRACE_MINUTES,
      default: DEFAULT_GRACE_MINUTES,
      description: 'Minutes after the start time that still count as present',
    }),
    // Multipart fields arrive as strings.
    Type(() => Number),
    IsInt(),
    Min(0),
    Max(MAX_GRACE_MINUTES),
  );
}
