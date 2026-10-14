import { BadRequestException, PipeTransform } from '@nestjs/common';

/**
 * Positive integer that safely fits in a PostgreSQL BIGINT column. Longer
 * values would make the database throw instead of returning a 400/404.
 */
export const NUMERIC_ID_PATTERN = /^[1-9]\d{0,17}$/;

export class ParseNumericIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !NUMERIC_ID_PATTERN.test(value)) {
      throw new BadRequestException('id must be a positive integer');
    }
    return value;
  }
}
