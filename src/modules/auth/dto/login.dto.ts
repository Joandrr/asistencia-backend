import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: '123456',
    minLength: 6,
    maxLength: 12,
    pattern: '^\\d{6,12}$',
  })
  @IsString()
  @Matches(/^\d{6,12}$/)
  registrationNo!: string;

  @ApiProperty({ example: 'your-password' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
