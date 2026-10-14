import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ClassSchedule } from './class-schedule.entity';
import { Enrollment } from './enrollment.entity';
import { AuditLog } from './audit-log.entity';

@Entity({ name: 'modules' })
export class Module extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => ClassSchedule, (schedule) => schedule.module)
  schedules!: ClassSchedule[];

  @OneToMany(() => Enrollment, (enrollment) => enrollment.module)
  enrollments!: Enrollment[];

  @OneToMany(() => AuditLog, (auditLog) => auditLog.module)
  auditLogs!: AuditLog[];
}
