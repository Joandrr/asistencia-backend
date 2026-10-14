import { Check, Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Enrollment } from './enrollment.entity';
import { ClassSchedule } from './class-schedule.entity';

export enum AttendanceStatus {
  PRESENT = 'present',
  LATE = 'late',
  ABSENT = 'absent',
  EXCUSED = 'excused',
}

@Entity({ name: 'attendance' })
@Unique('UQ_attendance_enrollment_schedule', ['enrollmentId', 'scheduleId'])
@Check(
  'CHK_attendance_status',
  `"status" IN ('present', 'late', 'absent', 'excused')`,
)
export class Attendance extends BaseEntity {
  @Column({ name: 'enrollment_id', type: 'bigint' })
  enrollmentId!: string;

  @ManyToOne(() => Enrollment, (enrollment) => enrollment.attendanceRecords, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment!: Enrollment;

  @Column({ name: 'schedule_id', type: 'bigint' })
  scheduleId!: string;

  @ManyToOne(() => ClassSchedule, (schedule) => schedule.attendanceRecords, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'schedule_id' })
  schedule!: ClassSchedule;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status!: AttendanceStatus;

  @Column({ name: 'marked_at', type: 'timestamptz', nullable: true })
  markedAt!: Date | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;
}
