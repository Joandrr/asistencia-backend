import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModuleImportSupport1791946769634 implements MigrationInterface {
  name = 'ModuleImportSupport1791946769634';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "email" VARCHAR(254)`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_email" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_lowercase" CHECK ("email" = LOWER("email"))`,
    );

    // RN-01: keep only the most recent active module before enforcing a single
    // active module. Older modules are deactivated, never deleted (RN-08).
    await queryRunner.query(`
      UPDATE "modules" SET "is_active" = FALSE, "updated_at" = CURRENT_TIMESTAMP
      WHERE "is_active" AND "deleted_at" IS NULL AND "id" <> (
        SELECT "id" FROM "modules"
        WHERE "is_active" AND "deleted_at" IS NULL
        ORDER BY "created_at" DESC, "id" DESC
        LIMIT 1
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "modules" ALTER COLUMN "is_active" SET DEFAULT FALSE`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_modules_single_active" ON "modules" ("is_active")
      WHERE "is_active" AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_class_schedules_module_date"
      ON "class_schedules" ("module_id", "class_date")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_enrollments_module" ON "enrollments" ("module_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_enrollments_module"`);
    await queryRunner.query(`DROP INDEX "UQ_class_schedules_module_date"`);
    await queryRunner.query(`DROP INDEX "UQ_modules_single_active"`);
    await queryRunner.query(
      `ALTER TABLE "modules" ALTER COLUMN "is_active" SET DEFAULT TRUE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_email_lowercase"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_email"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
  }
}
