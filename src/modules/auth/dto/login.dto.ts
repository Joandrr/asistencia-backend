import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin1', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  registrationNo!: string;

  @ApiProperty({ example: 'your-password', minLength: 7, maxLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(7)
  @MaxLength(12)
  password!: string;
}
