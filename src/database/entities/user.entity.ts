import { Check, Column, Entity, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Enrollment } from './enrollment.entity';
import { AuditLog } from './audit-log.entity';

export enum UserRole {
  STUDENT = 'student',
  ADMIN = 'admin',
}

@Entity({ name: 'users' })
@Unique('UQ_users_registration_no', ['registrationNo'])
@Check('CHK_users_role', `"role" IN ('student', 'admin')`)
export class User extends BaseEntity {
  @Column({ name: 'role', type: 'varchar', length: 20 })
  role!: UserRole;

  @Column({ name: 'registration_no', type: 'varchar', length: 50 })
  registrationNo!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 200, nullable: true })
  fullName!: string | null;

  @Column({ name: 'degree_program', type: 'varchar', length: 150, nullable: true })
  degreeProgram!: string | null;

  @OneToMany(() => Enrollment, (enrollment) => enrollment.student)
  enrollments!: Enrollment[];

  @OneToMany(() => AuditLog, (auditLog) => auditLog.user)
  auditLogs!: AuditLog[];
}
