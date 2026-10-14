import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare } from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { LoginDto } from './dto/login.dto';

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
}
