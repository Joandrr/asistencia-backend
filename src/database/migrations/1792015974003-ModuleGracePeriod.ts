import { MigrationInterface, QueryRunner } from 'typeorm';

const DEFAULT_GRACE_MINUTES = 10;

export class ModuleGracePeriod1792015974003 implements MigrationInterface {
  name = 'ModuleGracePeriod1792015974003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "modules" ADD "grace_minutes" SMALLINT NOT NULL DEFAULT ${DEFAULT_GRACE_MINUTES}`,
    );
    await queryRunner.query(
      `ALTER TABLE "modules" ADD CONSTRAINT "CHK_modules_grace_minutes" CHECK ("grace_minutes" BETWEEN 0 AND 240)`,
    );

    // Apply the default tolerance to the active module's upcoming classes.
    // Past classes keep the tolerance they were marked with. LEAST keeps the
    // result within the class (no midnight wrap, satisfies the grace CHECK).
    await queryRunner.query(
      `UPDATE "class_schedules" s
       SET "grace_time" = s."start_time"
             + LEAST(make_interval(mins => m."grace_minutes"), s."end_time" - s."start_time"),
           "updated_at" = CURRENT_TIMESTAMP
       FROM "modules" m
       WHERE m."id" = s."module_id" AND m."is_active" AND m."deleted_at" IS NULL
         AND s."deleted_at" IS NULL
         AND s."class_date" >= (CURRENT_TIMESTAMP AT TIME ZONE $1)::date`,
      [process.env.APP_TIMEZONE ?? 'America/La_Paz'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "modules" DROP CONSTRAINT "CHK_modules_grace_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "modules" DROP COLUMN "grace_minutes"`,
    );
  }
}
