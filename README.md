# Family Hub

A shared family application. Stage 1 provides a Kotlin/Ktor backend and a React/TypeScript application shell with Today, Tasks, Shop, and Calendar routes.

## Local development

Prerequisites: JDK 25 and Node.js 22.12+ (Node 22 LTS recommended). Gradle is included through the wrapper.

Start the backend:

```sh
cd backend
./gradlew run
```

In another terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The backend listens on port 8080. Vite proxies `/health` and `/api` to the backend, so browser requests can use the same origin without CORS configuration.

```sh
curl http://localhost:8080/health
# {"status":"ok"}
curl http://localhost:5173/health
# {"status":"ok"}
```

## Test from another device over Tailscale

Start both development servers as above, and connect this computer and your other device to the same Tailscale network. On the other device, open:

```text
http://<this-computer-tailscale-ip>:5173
```

Find this computer's Tailscale IPv4 address in the Tailscale app (or run `tailscale ip -4`). Keep this computer awake and both development servers running while testing.

The development command already listens on all network interfaces, including Tailscale. Use the IP address directly; Vite accepts IP hosts by default. API requests go through the frontend proxy, so the other device needs only port 5173. You can check connectivity at `http://<this-computer-tailscale-ip>:5173/health`, which should return `{"status":"ok"}`. Your tailnet access rules must permit connections to this computer on port 5173.

These instructions apply to `npm run dev`; the Docker skeleton below still binds its published ports to loopback.

### Tailscale HTTPS URL

Copy `frontend/.env.example` to `frontend/.env.local` and set `DEV_ALLOWED_HOSTS` to your computer's Tailscale hostname, without `https://`, a port, or a path. Multiple hostnames can be separated by commas. Restart the frontend after changing this setting.

The `.env.local` file is ignored by Git. This setting is read only by the Vite server configuration and is not exposed as a client-side environment variable. With it unset, Vite still accepts localhost and IP addresses.

Tailscale Serve forwards `https://<machine>.<tailnet>.ts.net/` to the frontend on port 5173. First check `tailscale serve status` for any existing service using the URL, then run:

```sh
tailscale serve --bg http://127.0.0.1:5173
```

Connect your other device to Tailscale and open the HTTPS URL shown by the command. Both development servers must remain running and the host computer must stay awake. `/health` uses the same HTTPS origin and forwards to the backend. Tailscale Serve keeps access within your tailnet.

## Checks

```sh
cd backend
./gradlew test installDist
```

```sh
cd frontend
npm run build
```

## Docker skeleton

With Docker Engine running, from the repository root:

```sh
docker compose up --build
```

Open http://localhost:5173. The web container serves the app and proxies `/health` and `/api/` to the backend. Frontend routes support direct navigation and refresh. Ports are bound to loopback for local development; final Tailscale deployment configuration belongs to Stage 12.

## Scope

The four screens are still placeholders. React Router and the TanStack Query provider are wired in. `/health` returns HTTP 200 and JSON without user identification.

Stage 2 adds the SQLite persistence foundation. On backend startup, Flyway creates the initial schema and seeds one `Family` household with `User 1` and `User 2`; Exposed is then connected for the feature adapters that will be added in later stages. The default database path is `data/family.db`, relative to the backend process, and can be overridden with `DATABASE_PATH`.

Stage 3 adds the Tasks API. User selection, shopping, Google Calendar, PWA installation, and persistent Docker storage remain for later stages in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Backend architecture

The backend uses four Gradle modules:

| Module | Responsibility | Project dependencies |
| --- | --- | --- |
| `core-domain` | Task behavior, users, filters, repository contracts | None |
| `core-application` | Task use cases, user identification, transaction port | Domain |
| `core-infrastructure-sqlite` | Exposed adapters, Flyway migrations, SQLite transactions | Domain, application |
| `service-api-ktor` | HTTP routes, request/response DTOs, mappers, error handling, composition root | All three modules |

Domain and application code have no HTTP or persistence framework dependencies. The API resolves `X-User-Id` through `UserService` before invoking task use cases with a known user. The task domain accepts a non-null `UserId` for assignment and exposes a separate `unassign()` operation. The application service checks assignee existence and household membership; `Task` does not depend on the `User` entity. The domain enforces archive rules. Services load a task, call its domain method, and persist it through `TaskRepository.save`. A transaction port keeps that sequence atomic without exposing Exposed to application code. Separate read and save transactions could otherwise overwrite a concurrent change.

`TaskId`, `UserId`, and `HouseholdId` are UUID-backed value classes. Repository `find` methods return nullable results; default `get` methods call `find` and throw when absent. Task lookups require both household and task IDs so callers cannot accidentally read another household's data.

Root development commands remain available. The `run` task keeps `backend/` as the working directory, preserving the existing default database location. The Dockerfile uses the API module's application distribution.

## Tasks API

Every task request requires `X-User-Id` with a seeded user UUID:

- User 1: `00000000-0000-0000-0000-000000000101`
- User 2: `00000000-0000-0000-0000-000000000102`

The server derives the household and creator from that user. Tasks are shared within the household, and assignees must belong to it. This header is MVP identification for private network access, not authentication.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/tasks` | Lists tasks; optional `completed`, `from`, `to`, `assignedTo`, `archived` filters combine |
| GET | `/api/tasks/{id}` | Reads a household task, including an archived task |
| POST | `/api/tasks` | Creates an unassigned task; returns 201 with the task and a Location header |
| PATCH | `/api/tasks/{id}` | Edits only title and due date; returns the updated task |
| POST | `/api/tasks/{id}/assign` | Assigns a household member using a required, non-null `assignedTo` UUID |
| POST | `/api/tasks/{id}/unassign` | Clears assignment |
| POST | `/api/tasks/{id}/complete` | Completes a task |
| POST | `/api/tasks/{id}/reopen` | Marks a completed task incomplete |
| POST | `/api/tasks/{id}/archive` | Archives a task, retaining its row and archive timestamp |

POST accepts `title` (required, nonblank) and optional `dueDate` (ISO date). PATCH accepts only those two fields: omitted fields remain unchanged, and explicit `null` clears `dueDate`. Titles are trimmed. Assignment requires an `assignedTo` field containing a UUID. Use the separate unassign endpoint to clear it. Unknown JSON fields are rejected. Responses include `id`, `title`, `dueDate`, `completed`, `assignedTo`, `createdBy`, `createdAt`, and `archivedAt`.

GET lists non-archived tasks by default; `archived=true` lists archived tasks. Both completed and incomplete tasks are returned unless filtered. Date bounds are inclusive and exclude undated tasks when supplied. `TaskFilter` validates the range with `InvalidTaskFilter` and always contains a household ID. Results are ordered by creation time and ID.

Archived tasks remain readable but cannot be edited, assigned, completed, or reopened. Repeating archive preserves the first archive timestamp. There is no task DELETE operation. Archiving retains the task's final state; it does not introduce an audit log of every edit.

Invalid input returns 400, missing/invalid/unknown user identification returns 401, missing tasks or tasks belonging to another household return 404, and changes to archived tasks return 409. Error bodies contain an `error` string.

```sh
curl http://localhost:8080/api/tasks \
  -H 'X-User-Id: 00000000-0000-0000-0000-000000000101'

curl -X POST http://localhost:8080/api/tasks \
  -H 'X-User-Id: 00000000-0000-0000-0000-000000000101' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Call the doctor","dueDate":"2026-09-18"}'
```

## Backend tests

- `core-domain`: `TaskTest` covers domain operations and invariants; `TaskFilterTest` covers date-range validation.
- `core-application`: `TaskServiceTest` and `UserServiceTest` cover use cases using empty in-memory repositories populated through `save`.
- `core-infrastructure-sqlite`: integration specs use temporary SQLite files to check repository mapping, filtering, transaction rollback, and the initial schema including archiving.
- `service-api-ktor`: `TaskRoutesSpec` starts the real application with temporary SQLite files and exercises HTTP workflows, input validation, household isolation, and archive persistence across restarts.

Tests use JUnit Jupiter with Kotest assertions, including Kotest HTTP assertions for functional specs.

The initial V1 migration includes `archived_at`; only V1 and V2 are retained. Existing databases created with the earlier V1 require recreation or a deliberate Flyway migration-history reconciliation before startup.

Reusable domain data and in-memory repositories live in their modules' `testFixtures` source sets. Functional specs use the production persistence adapters. No frontend task functionality is included in Stage 3.
