import { UserRole } from '../../database/entities/user.entity';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
