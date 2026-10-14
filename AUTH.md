# JWT authentication and role authorization

The API uses short-lived JWT bearer tokens. The global `JwtAuthGuard` validates
the token, loads the current user from PostgreSQL, and puts only the current
user's `id` and `role` on `request.user`. The global `RolesGuard` enforces
`@Roles(...)` metadata on controllers or route handlers.

Interactive API documentation is available at `http://localhost:3000/api/docs`
when the app is running. After calling login in Swagger, click **Authorize**
and enter the returned access token to try protected endpoints.

## Configuration

Add a private secret to `.env` (do not commit it):

```env
JWT_SECRET=<at-least-32-random-bytes>
```

For example, generate one locally with `openssl rand -base64 32`.

## Login

`POST /auth/login` is public and expects:

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
initial administrator, set `ADMIN_REGISTRATION_NO`, `ADMIN_PASSWORD` (7–12
characters), and optionally `ADMIN_FULL_NAME` in `.env`, then run:

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
