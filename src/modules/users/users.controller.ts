import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from './entities/user.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a user (admin only)' })
  @ApiCreatedResponse({
    description: 'User created; the password is never returned.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Only administrators may create users' })
  @ApiConflictResponse({ description: 'Registration number already exists' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.create(dto, actor);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List users, including soft-deleted users (admin only)',
  })
  @ApiOkResponse({ description: 'Paginated list of users and deletion status' })
  findAll(@Query() query: ListUsersDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Find a user by ID, including soft-deleted users (admin only)',
  })
  @ApiOkResponse({ description: 'User details, including deletedAt status' })
  @ApiNotFoundResponse({ description: 'User ID does not exist' })
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an active user (admin only)' })
  @ApiOkResponse({ description: 'Updated user without password data' })
  @ApiNotFoundResponse({ description: 'Active user not found' })
  @ApiConflictResponse({ description: 'Duplicate registration or last admin' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Soft-delete an active user (admin only)' })
  @ApiOkResponse({ description: 'Soft-deleted user details' })
  @ApiNotFoundResponse({ description: 'Active user not found' })
  @ApiConflictResponse({ description: 'Cannot delete the last active admin' })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.remove(id, actor);
  }

  @Post(':id/restore')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Restore a soft-deleted user (admin only)' })
  @ApiOkResponse({ description: 'Restored user details' })
  @ApiNotFoundResponse({ description: 'User ID does not exist' })
  @ApiConflictResponse({ description: 'User is already active' })
  restore(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.restore(id, actor);
  }
}
