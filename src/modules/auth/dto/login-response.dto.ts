import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../database/entities/user.entity';

class LoginUserDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN })
  role!: UserRole;

  @ApiProperty({ example: 'admin1' })
  registrationNo!: string;

  @ApiProperty({ example: 'System Administrator', nullable: true })
  fullName!: string | null;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT bearer access token' })
  access_token!: string;

  @ApiProperty({ example: 'Bearer' })
  token_type!: string;

  @ApiProperty({ example: 43200, description: 'Token lifetime in seconds' })
  expires_in!: number;

  @ApiProperty({ type: LoginUserDto })
  user!: LoginUserDto;
}
