import { UserRole } from '../users/entities/user.entity';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
