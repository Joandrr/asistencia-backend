# JWT authentication and role authorization

The API uses short-lived JWT bearer tokens. The global `JwtAuthGuard` validates
the token, loads the current user from PostgreSQL, and puts only the current
user's `id` and `role` on `request.user`. The global `RolesGuard` enforces
`@Roles(...)` metadata on controllers or route handlers.

Interactive API documentation is available at `http://localhost:3000/api/v1/docs`
when the app is running. After calling login in Swagger, click **Authorize**
and enter the returned access token to try protected endpoints.

## Configuration

Add a private secret to `.env` (do not commit it):

```env
JWT_SECRET=<at-least-32-random-bytes>
```

For example, generate one locally with `openssl rand -base64 32`.

## Login

`POST /api/v1/auth/login` is public and expects:

```json
{
  "registrationNo": "your-registration-number",
  "password": "your-password"
}
```

It compares the password against the stored bcrypt hash and returns an
`access_token` valid for 12 hours. Send it on protected requests as:

```http
Authorization: Bearer <access_token>
```

There is no public registration or password-reset endpoint. To create the
initial administrator, set `ADMIN_REGISTRATION_NO` (7–12 digits),
`ADMIN_PASSWORD` (at least 8 characters), and optionally `ADMIN_FULL_NAME` in
`.env`, then run:

```bash
npm run migration:run
npm run seed:admin
```

The seed script hashes the password with bcrypt and is safe to re-run: it does
not overwrite an existing account or reset its password. If that registration
number already belongs to a non-admin user, it exits without changing it.

## Role protection

Global authentication is enabled; mark only genuinely public routes with
`@Public()`. Add role metadata to domain controllers/handlers, for example:

```ts
@Controller('admin/modules')
@Roles(UserRole.ADMIN)
export class AdminModulesController {}
```

`@Roles(UserRole.ADMIN, UserRole.STUDENT)` allows either role. If no `@Roles`
metadata is set, any authenticated user may access the handler. A role guard
does not enforce ownership: student-specific queries must also filter by the
authenticated user's ID (available through `@CurrentUser()`).

Unauthenticated requests receive `401`; authenticated users with a disallowed
role receive `403`.

## User creation and first login

Only an administrator can create users through `POST /users`. The `registrationNo`
must contain 7–12 digits and be unique; passwords must contain at least 8
characters. The role must be one of the application roles. Students must have a
`degreeProgram`; administrators must not. `fullName` is required for either
role. The initial password is bcrypt-hashed and never returned or written to the
user-creation audit event. User creation and its audit record are committed in
the same database transaction.

Authenticated users can change their own password with
`POST /api/v1/auth/change-password`.
Send the current password, a different new password of at least 8 characters, and
a valid bearer token. The password is re-hashed with bcrypt; no database schema
migration is required.

## CORS

Set `CORS_ORIGIN` in `.env` to the exact frontend origin, including protocol
and port (for example, `http://localhost:5173`). Multiple origins may be
comma-separated. Requests from other browser origins are not allowed. CORS
allows the `Authorization` header used by bearer-token authentication.

## User administration

All user-administration routes require an administrator bearer token:

- `POST /api/v1/users` creates a user.
- `GET /api/v1/users` returns a paginated list; it includes soft-deleted users by default. Optional query parameters: `page`, `limit` (maximum 100), `role`, and `q` (registration number/name search).
- `GET /api/v1/users/:id` returns the user even when soft-deleted; `deletedAt` indicates that status.
- `PATCH /api/v1/users/:id` updates an active user.
- `DELETE /api/v1/users/:id` soft-deletes an active user.
- `POST /api/v1/users/:id/restore` restores a soft-deleted user.

The users table has no separate `isActive` field; soft-deletion is represented by
`deletedAt`. Password hashes are never included in responses or audit values.
