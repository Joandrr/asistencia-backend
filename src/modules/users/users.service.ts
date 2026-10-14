import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { User, UserRole } from './entities/user.entity';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    const fullName = dto.fullName.trim();
    const degreeProgram = dto.degreeProgram?.trim();

    if (!fullName) {
      throw new BadRequestException('fullName must not be blank');
    }
    this.validateRoleFields(dto.role, degreeProgram);
    this.validatePasswordBytes(dto.password);

    const passwordHash = await hash(dto.password, 12);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const userRepository = manager.getRepository(User);
        const user = userRepository.create({
          registrationNo: dto.registrationNo,
          passwordHash,
          role: dto.role,
          fullName,
          degreeProgram: dto.role === UserRole.STUDENT ? degreeProgram! : null,
        });
        const savedUser = await userRepository.save(user);
        await this.writeAudit(
          manager,
          actor.id,
          'user.created',
          null,
          savedUser,
        );
        return this.toResponse(savedUser);
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async findAll(query: ListUsersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const builder = this.users.createQueryBuilder('user').withDeleted();

    if (query.role) {
      builder.andWhere('user.role = :role', { role: query.role });
    }
    const search = query.q?.trim();
    if (search) {
      builder.andWhere(
        '(user.registrationNo ILIKE :search OR user.fullName ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [users, total] = await builder
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: users.map((user) => this.toResponse(user)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    this.validateId(id);
    const user = await this.users.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toResponse(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    this.validateId(id);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Active user not found');

    const previousValue = this.auditValue(user);
    const resultingRole = dto.role ?? user.role;
    const fullName =
      dto.fullName === undefined ? user.fullName : dto.fullName.trim();
    if (!fullName) {
      throw new BadRequestException('fullName must not be blank');
    }

    const requestedDegree = dto.degreeProgram;
    const resultingDegree =
      requestedDegree === undefined
        ? user.degreeProgram
        : requestedDegree?.trim() || null;
    if (resultingRole === UserRole.STUDENT && !resultingDegree?.trim()) {
      throw new BadRequestException(
        'degreeProgram is required for student users',
      );
    }
    if (
      resultingRole === UserRole.ADMIN &&
      requestedDegree !== undefined &&
      requestedDegree?.trim()
    ) {
      throw new BadRequestException(
        'degreeProgram is only applicable to student users',
      );
    }

    if (
      user.role === UserRole.ADMIN &&
      resultingRole !== UserRole.ADMIN &&
      (await this.countActiveAdmins()) <= 1
    ) {
      throw new ConflictException(
        'The last active administrator cannot be demoted',
      );
    }
    if (id === actor.id && resultingRole !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'You cannot remove your own administrator role',
      );
    }

    user.registrationNo = dto.registrationNo ?? user.registrationNo;
    user.role = resultingRole;
    user.fullName = fullName;
    user.degreeProgram =
      resultingRole === UserRole.ADMIN ? null : resultingDegree;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const savedUser = await manager.getRepository(User).save(user);
        await this.writeAudit(
          manager,
          actor.id,
          'user.updated',
          previousValue,
          savedUser,
        );
        return this.toResponse(savedUser);
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async remove(id: string, actor: AuthenticatedUser) {
    this.validateId(id);
    if (id === actor.id) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Active user not found');

    if (user.role === UserRole.ADMIN && (await this.countActiveAdmins()) <= 1) {
      throw new ConflictException(
        'The last active administrator cannot be deleted',
      );
    }

    const previousValue = this.auditValue(user);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const deletedUser = await repository.softRemove(user);
      await this.writeAudit(
        manager,
        actor.id,
        'user.deleted',
        previousValue,
        deletedUser,
      );
      return this.toResponse(deletedUser);
    });
  }

  async restore(id: string, actor: AuthenticatedUser) {
    this.validateId(id);
    const user = await this.users.findOne({ where: { id }, withDeleted: true });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deletedAt) {
      throw new ConflictException('User is already active');
    }

    const previousValue = this.auditValue(user);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const restoredUser = await manager.getRepository(User).recover(user);
        await this.writeAudit(
          manager,
          actor.id,
          'user.restored',
          previousValue,
          restoredUser,
        );
        return this.toResponse(restoredUser);
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  private validateRoleFields(
    role: UserRole,
    degreeProgram: string | null | undefined,
  ) {
    if (role === UserRole.STUDENT && !degreeProgram?.trim()) {
      throw new BadRequestException(
        'degreeProgram is required for student users',
      );
    }
    if (role === UserRole.ADMIN && degreeProgram?.trim()) {
      throw new BadRequestException(
        'degreeProgram is only applicable to student users',
      );
    }
  }

  private validatePasswordBytes(password: string) {
    // bcrypt only processes the first 72 UTF-8 bytes; reject instead of truncating.
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('password must not exceed 72 UTF-8 bytes');
    }
  }

  private validateId(id: string) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('id must be a positive integer');
    }
  }

  private async countActiveAdmins() {
    return this.users.count({ where: { role: UserRole.ADMIN } });
  }

  private async writeAudit(
    manager: EntityManager,
    actorId: string,
    action: string,
    previous: Record<string, unknown> | null,
    user: User,
  ) {
    const auditRepository = manager.getRepository(AuditLog);
    await auditRepository.save(
      auditRepository.create({
        userId: actorId,
        moduleId: null,
        action,
        affectedEntity: 'users',
        affectedRecordId: user.id,
        previousValue: previous,
        newValue: this.auditValue(user),
      }),
    );
  }

  private auditValue(user: User): Record<string, unknown> {
    return {
      id: user.id,
      registrationNo: user.registrationNo,
      role: user.role,
      fullName: user.fullName,
      degreeProgram: user.degreeProgram,
      deletedAt: user.deletedAt,
    };
  }

  private toResponse(user: User) {
    return {
      id: user.id,
      role: user.role,
      registrationNo: user.registrationNo,
      fullName: user.fullName,
      degreeProgram: user.degreeProgram,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    };
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === '23505'
    ) {
      throw new ConflictException(
        'A user with this registrationNo already exists',
      );
    }
    throw error;
  }
}
