import { Check, Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ClassSchedule } from './class-schedule.entity';
import { Enrollment } from './enrollment.entity';
import { AuditLog } from './audit-log.entity';

@Entity({ name: 'modules' })
// RN-01: at most one active module.
@Index('UQ_modules_single_active', ['isActive'], {
  unique: true,
  where: '"is_active" AND "deleted_at" IS NULL',
})
@Check('CHK_modules_grace_minutes', '"grace_minutes" BETWEEN 0 AND 240')
export class Module extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  /** Minutes after the start time in which a mark still counts as present. */
  @Column({ name: 'grace_minutes', type: 'smallint', default: 10 })
  graceMinutes!: number;

  @OneToMany(() => ClassSchedule, (schedule) => schedule.module)
  schedules!: ClassSchedule[];

  @OneToMany(() => Enrollment, (enrollment) => enrollment.module)
  enrollments!: Enrollment[];

  @OneToMany(() => AuditLog, (auditLog) => auditLog.module)
  auditLogs!: AuditLog[];
}
