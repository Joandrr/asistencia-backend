import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: '1234567',
    minLength: 7,
    maxLength: 12,
    pattern: '^\\d{7,12}$',
  })
  @IsString()
  @Matches(/^\d{7,12}$/)
  registrationNo!: string;

  @ApiProperty({ example: 'your-password' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
