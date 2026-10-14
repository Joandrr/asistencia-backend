import { Check, Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Module } from './module.entity';
import { Attendance } from './attendance.entity';

@Entity({ name: 'class_schedules' })
@Check('CHK_class_schedules_time_order', '"end_time" > "start_time"')
@Check(
  'CHK_class_schedules_grace_time',
  '"grace_time" >= "start_time" AND "grace_time" <= "end_time"',
)
export class ClassSchedule extends BaseEntity {
  @Column({ name: 'module_id', type: 'bigint' })
  moduleId!: string;

  @ManyToOne(() => Module, (module) => module.schedules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module!: Module;

  @Column({ name: 'class_date', type: 'date' })
  classDate!: string;

  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;

  @Column({ name: 'grace_time', type: 'time' })
  graceTime!: string;

  @OneToMany(() => Attendance, (attendance) => attendance.schedule)
  attendanceRecords!: Attendance[];
}
