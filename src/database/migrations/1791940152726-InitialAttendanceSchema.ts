import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialAttendanceSchema1791940152726 implements MigrationInterface {
  name = 'InitialAttendanceSchema1791940152726';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMPTZ,
        "role" VARCHAR(20) NOT NULL,
        "registration_no" VARCHAR(12) NOT NULL,
        "password_hash" TEXT NOT NULL,
        "full_name" VARCHAR(200),
        "degree_program" VARCHAR(150),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_registration_no" UNIQUE ("registration_no"),
        CONSTRAINT "CHK_users_role" CHECK ("role" IN ('student', 'admin'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "modules" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMPTZ,
        "name" VARCHAR(150) NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT "PK_modules_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "class_schedules" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMPTZ,
        "module_id" BIGINT NOT NULL,
        "class_date" DATE NOT NULL,
        "start_time" TIME NOT NULL,
        "end_time" TIME NOT NULL,
        "grace_time" TIME NOT NULL,
        CONSTRAINT "PK_class_schedules_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_class_schedules_time_order" CHECK ("end_time" > "start_time"),
        CONSTRAINT "CHK_class_schedules_grace_time"
          CHECK ("grace_time" >= "start_time" AND "grace_time" <= "end_time"),
        CONSTRAINT "FK_class_schedules_module"
          FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "enrollments" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMPTZ,
        "student_id" BIGINT NOT NULL,
        "module_id" BIGINT NOT NULL,
        "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_enrollments_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_enrollments_student_module" UNIQUE ("student_id", "module_id"),
        CONSTRAINT "FK_enrollments_student"
          FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_enrollments_module"
          FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "attendance" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMPTZ,
        "enrollment_id" BIGINT NOT NULL,
        "schedule_id" BIGINT NOT NULL,
        "status" VARCHAR(20) NOT NULL,
        "marked_at" TIMESTAMPTZ,
        "notes" TEXT,
        CONSTRAINT "PK_attendance_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_attendance_enrollment_schedule" UNIQUE ("enrollment_id", "schedule_id"),
        CONSTRAINT "CHK_attendance_status"
          CHECK ("status" IN ('present', 'late', 'absent', 'excused')),
        CONSTRAINT "FK_attendance_enrollment"
          FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_schedule"
          FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMPTZ,
        "user_id" BIGINT,
        "module_id" BIGINT,
        "action" VARCHAR(100) NOT NULL,
        "affected_entity" VARCHAR(100),
        "affected_record_id" VARCHAR(100),
        "previous_value" JSONB,
        "new_value" JSONB,
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_audit_logs_module"
          FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "audit_logs"');
    await queryRunner.query('DROP TABLE "attendance"');
    await queryRunner.query('DROP TABLE "enrollments"');
    await queryRunner.query('DROP TABLE "class_schedules"');
    await queryRunner.query('DROP TABLE "modules"');
    await queryRunner.query('DROP TABLE "users"');
  }
}
