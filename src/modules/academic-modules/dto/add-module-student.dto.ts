import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

export class AddModuleStudentDto {
  @ApiProperty({ example: '221043837', pattern: '^\\d{6,12}$' })
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{6,12}$/, {
    message: 'registrationNo must contain between 6 and 12 digits',
  })
  registrationNo!: string;

  @ApiProperty({ example: 'Juan Pérez', maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\p{L}/u, { message: 'fullName must contain letters' })
  fullName!: string;

  @ApiProperty({ example: 'juan@gmail.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email!: string;
}
