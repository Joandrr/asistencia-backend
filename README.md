# Asistencia · Backend

API REST del **Sistema Web de Registro y Control de Asistencia**. El administrador carga cada módulo académico con dos Excel (estudiantes y fechas de clase), y los estudiantes marcan su asistencia en las fechas habilitadas. Solo hay **un módulo activo a la vez**. Al activar uno nuevo, el anterior se conserva en la base de datos sin borrar nada.

El frontend está en el repositorio `asistencia-front`.

## Stack

- **NestJS 11** (TypeScript) con validación global (`class-validator`) y Swagger.
- **PostgreSQL** (Neon) con **TypeORM**. Los cambios de esquema se hacen con migraciones (`synchronize` está desactivado).
- **JWT** para autenticación y roles `admin` / `student`.
- **ExcelJS** para importar y exportar Excel.

## Arquitectura

```
src/
├── main.ts                 # Prefijo /api/v1, CORS, ValidationPipe y Swagger
├── app.module.ts           # Config, TypeORM y módulos de la aplicación
├── common/                 # Lógica compartida y pura (con tests)
│   ├── attendance-status   # Estado efectivo: presente / atraso / falta / pendiente
│   ├── grace-period        # Cálculo del tiempo de gracia
│   ├── clock               # Fecha y hora según APP_TIMEZONE
│   └── numeric-id          # Validación de ids (bigint)
├── database/
│   ├── entities/           # Module, ClassSchedule, Enrollment, Attendance, AuditLog
│   ├── migrations/         # Historial del esquema (se ejecutan en orden)
│   ├── data-source.ts      # Configuración para el CLI de TypeORM
│   └── seed-*.ts           # Datos iniciales (admin, estudiante y demo)
└── modules/
    ├── auth/               # Login, JWT, cambio de contraseña, guards y decoradores
    ├── users/              # CRUD de usuarios (solo admin)
    ├── academic-modules/   # Importación por Excel, activación, gracia y alta manual
    ├── attendance/         # Marca y historial del estudiante, corrección del admin
    └── attendance-admin/   # Estudiantes y asistencias del módulo activo y exportación a Excel
```

**Seguridad.**
- `JwtAuthGuard` y `RolesGuard` son **globales**: todo requiere token salvo las rutas con `@Public()`.
- Las funciones de administración llevan `@Roles(UserRole.ADMIN)`.
- El guard vuelve a leer al usuario en cada request, así que una cuenta desactivada pierde el acceso de inmediato.
- Detalles en [AUTH.md](AUTH.md).

**Datos.**
- El índice único `UQ_modules_single_active` garantiza un solo módulo activo.
- Cada clase de la asistencia pertenece a un módulo a través de `enrollments` y `class_schedules`.
- Toda acción importante (activar un módulo, corregir una asistencia, cambiar la gracia, añadir un estudiante) queda en `audit_logs` con los valores anterior y nuevo.
- Más información en [DATABASE.md](DATABASE.md).

**Reglas principales.**
- **Presente:** la marca ocurre dentro del tiempo de gracia del módulo (por defecto 10 min desde el inicio de la clase).
- **Atraso:** la marca ocurre después de la gracia. Cuenta como asistencia.
- **Falta:** la clase terminó y no hay marca, o el admin registró una falta.
- **% de asistencia:** `(presentes + atrasos) / (presentes + atrasos + faltas)`.

### Endpoints principales (`/api/v1`)

| Área | Rutas | Rol |
|---|---|---|
| Autenticación | `POST /auth/login`, `POST /auth/change-password` | Público / cualquiera |
| Usuarios | `GET/POST /users`, `PATCH/DELETE /users/:id`, `POST /users/:id/restore` | Admin |
| Módulos | `GET /modules/active`, `PATCH /modules/active/grace-period`, `GET /modules/templates/:kind`, `POST /modules/import/preview`, `POST /modules/activate` | Admin |
| Asistencia del estudiante | `GET /attendance/today`, `POST /attendance/mark`, `GET /attendance/history` | Estudiante |
| Corrección | `POST /attendance/admin/correct` | Admin |
| Administración | `GET/POST /admin/students`, `GET /admin/attendance/summary`, `GET /admin/attendance/by-date`, `GET /admin/attendance/by-student/:id`, `GET /admin/attendance/export` | Admin |

La documentación completa e interactiva está en Swagger: **http://localhost:3000/api/v1/docs**.

## Cómo hacerlo correr

**Requisitos:** Node.js 20 o superior (probado con 24) y una base PostgreSQL (por ejemplo, un proyecto o branch en [Neon](https://neon.tech)).

1. **Instala las dependencias.**
   ```bash
   npm install
   ```
2. **Configura el entorno.** Copia `.env.example` a `.env` y complétalo (ver la tabla de abajo).
   ```bash
   cp .env.example .env
   ```
3. **Crea las tablas** aplicando las migraciones.
   ```bash
   npm run migration:run
   ```
4. **Crea el administrador inicial** con los datos `ADMIN_*` del `.env`. No hace nada si ya existe.
   ```bash
   npm run seed:admin
   ```
5. **Levanta la API.**
   ```bash
   npm run start:dev      # modo desarrollo: se reinicia al guardar cambios
   ```
   La API queda en `http://localhost:3000/api/v1`.

> Si cambias de rama o traes cambios con `git pull`, ejecuta `npm run migration:run` y reinicia la API. Un proceso iniciado con `npm run start` o `start:prod` **no** toma los cambios por sí solo.

### Variables de entorno

| Variable | Para qué sirve |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL. En Neon usa la cadena *pooled* con `sslmode=require`. |
| `PORT` | Puerto de la API (por defecto 3000). |
| `CORS_ORIGIN` | Origen exacto del frontend, por ejemplo `http://localhost:5173`. Si hay varios, sepáralos con comas. |
| `JWT_SECRET` | Secreto para firmar los tokens. **Mínimo 32 caracteres** aleatorios. |
| `ADMIN_REGISTRATION_NO` / `ADMIN_PASSWORD` / `ADMIN_FULL_NAME` | Datos del admin que crea `seed:admin`. |
| `RUN_MIGRATIONS` | `true` aplica las migraciones al arrancar. Déjalo en `false` y usa `migration:run`. |
| `APP_TIMEZONE` | Zona horaria de la institución (por defecto `America/La_Paz`). Define "hoy" y la hora de las marcas. |

### Scripts útiles

| Script | Qué hace |
|---|---|
| `npm run start:dev` | API en modo desarrollo con recarga automática. |
| `npm run build` y luego `npm run start:prod` | Compila a `dist/` y lo ejecuta. |
| `npm run migration:run` / `migration:show` / `migration:revert` | Aplica, lista o revierte migraciones. |
| `npm run migration:create -- src/database/migrations/Nombre` | Crea una migración vacía para escribirla a mano. |
| `npm run seed:admin` | Crea el administrador inicial. |
| `npm test` | Tests unitarios (Jest). |
| `npm run lint` | ESLint con Prettier. **Ojo:** aplica `--fix` automáticamente. |

## Uso rápido

1. Inicia sesión como admin con el registro y la contraseña de `ADMIN_*`.
2. En el front, ve a **Módulos**. Descarga las plantillas, llena los Excel de estudiantes y de fechas, valídalos y activa el módulo.
3. Los estudiantes importados entran con su **número de registro** como usuario y como contraseña inicial, que pueden cambiar en *Mi perfil*.
