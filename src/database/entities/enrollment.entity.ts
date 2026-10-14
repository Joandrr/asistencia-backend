import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Module } from './module.entity';
import { Attendance } from './attendance.entity';

@Entity({ name: 'enrollments' })
@Unique('UQ_enrollments_student_module', ['studentId', 'moduleId'])
export class Enrollment extends BaseEntity {
  @Column({ name: 'student_id', type: 'bigint' })
  studentId!: string;

  @ManyToOne(() => User, (user) => user.enrollments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student!: User;

  @Column({ name: 'module_id', type: 'bigint' })
  moduleId!: string;

  @ManyToOne(() => Module, (module) => module.enrollments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'module_id' })
  module!: Module;

  @Column({
    name: 'assigned_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  assignedAt!: Date;

  @OneToMany(() => Attendance, (attendance) => attendance.enrollment)
  attendanceRecords!: Attendance[];
}
