import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceAdminIndexes1791951148249 implements MigrationInterface {
  name = 'AttendanceAdminIndexes1791951148249';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // UQ_attendance_enrollment_schedule starts with enrollment_id, so lookups
    // by class date (admin overview per date) need their own index.
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_schedule" ON "attendance" ("schedule_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_attendance_schedule"`);
  }
}
