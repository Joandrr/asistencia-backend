# Database and migrations

This project uses PostgreSQL (Neon) with TypeORM migrations. Schema changes are
explicit migrations; TypeORM schema synchronization and automatic migration
execution are disabled by default.

## Configure Neon

1. Copy `.env.example` to `.env`.
2. In Neon, copy the connection string for your database (the pooled connection
   string is appropriate for the running application) into `DATABASE_URL`.
3. Keep `sslmode=require` in the connection string. Do not commit `.env`.

## Migration workflow

The initial schema migration is at
`src/database/migrations/1791940152726-InitialAttendanceSchema.ts`. It contains
the SQL to create the attendance-system tables. Review it before applying.

By default, starting the API does **not** execute migrations. To opt in for a
local environment, set `RUN_MIGRATIONS=true` in `.env`; TypeORM then applies
pending migrations during application startup. For production, leave it false
and run migrations explicitly as a deployment step to avoid multiple app
instances trying to migrate at the same time.

For later schema changes, update the TypeORM entities first, then:

```bash
# Generate a migration by comparing entities with the connected database
npm run migration:generate -- src/database/migrations/DescribeYourChange

# Review the generated SQL in the migration before applying it
npm run migration:run

# Check which migrations TypeORM considers pending/applied
npm run migration:show

# Revert the most recently applied migration (use cautiously)
npm run migration:revert
```

For an intentionally empty migration, use:

```bash
npm run migration:create -- src/database/migrations/SomeChange
```

Do not run migrations against a production Neon branch until the migration SQL
has been reviewed and backed up. `npm run migration:run` applies the migration
to the database selected by `DATABASE_URL`.
