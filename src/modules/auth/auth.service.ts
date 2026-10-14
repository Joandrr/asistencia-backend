import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async login(credentials: LoginDto) {
    const user = await this.users.findOne({
      where: { registrationNo: credentials.registrationNo },
    });
    const passwordMatches = user
      ? await compare(credentials.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      throw new UnauthorizedException(
        'Invalid registration number or password',
      );
    }

    const accessToken = await this.jwtService.signAsync({ sub: user.id });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 43200,
      user: {
        id: user.id,
        role: user.role,
        registrationNo: user.registrationNo,
        fullName: user.fullName,
      },
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (Buffer.byteLength(dto.newPassword, 'utf8') > 72) {
      throw new BadRequestException(
        'New password must not exceed 72 UTF-8 bytes',
      );
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists or is inactive');
    }
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await hash(dto.newPassword, 12);
    await this.users.save(user);
    return { message: 'Password changed successfully' };
  }
}
