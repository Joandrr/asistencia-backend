import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from '../../modules/users/entities/user.entity';
import { Module } from './module.entity';

@Entity({ name: 'audit_logs' })
export class AuditLog extends BaseEntity {
  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, (user) => user.auditLogs, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ name: 'module_id', type: 'bigint', nullable: true })
  moduleId!: string | null;

  @ManyToOne(() => Module, (module) => module.auditLogs, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'module_id' })
  module!: Module | null;

  @Column({ name: 'action', type: 'varchar', length: 100 })
  action!: string;

  @Column({
    name: 'affected_entity',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  affectedEntity!: string | null;

  @Column({
    name: 'affected_record_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  affectedRecordId!: string | null;

  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue!: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue!: Record<string, unknown> | null;
}
