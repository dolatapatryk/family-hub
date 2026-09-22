# Family Hub

A shared family app built with Kotlin/Ktor, React/TypeScript, and SQLite. The Tasks screen supports creating, assigning, completing, reopening, and archiving tasks. Today, Shop, and Calendar screens are placeholders. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the roadmap.

## Local development

Requires JDK 25 and Node.js 22.12+. Gradle is included via the wrapper.

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

Open [localhost:5173](http://localhost:5173). The backend runs on port 8080; Vite proxies `/api` and `/health` to it. `/health` returns `{"status":"ok"}`.

## Configuration

SQLite is initialized and seeded on startup. The default database is `backend/data/family.db` when using the commands above; override it with `DATABASE_PATH`.

For frontend overrides, copy `frontend/.env.example` to `frontend/.env.local` and restart Vite:

| Variable | Default / purpose |
| --- | --- |
| `VITE_API_URL` | `/api` |
| `VITE_USER_ID` | User 1: `00000000-0000-0000-0000-000000000101`; use `00000000-0000-0000-0000-000000000102` for User 2 |
| `DEV_ALLOWED_HOSTS` | Optional comma-separated development hostnames, without scheme, port, or path |

The API uses `X-User-Id` to identify a seeded household member. This is MVP identification for private network use, not authentication. `VITE_*` settings are applied at build time in production.

Existing databases created with the earlier V1 migration require recreation or deliberate Flyway migration-history reconciliation before startup.

## Access over Tailscale

With both devices on the same tailnet and both development servers running, open `http://<computer-tailscale-ip>:5173`. Find the IP with `tailscale ip -4`. The host must stay awake, and tailnet rules must allow port 5173.

For HTTPS, set `DEV_ALLOWED_HOSTS` to your machine's Tailscale hostname and restart Vite. Check for an existing service with `tailscale serve status`, then run:

```sh
tailscale serve --bg http://127.0.0.1:5173
```

Open the HTTPS URL shown by the command from a device on your tailnet.

## Checks

Backend:

```sh
cd backend
./gradlew test installDist
```

Frontend:

```sh
cd frontend
npm test
npm run build
```

## Docker

With Docker Engine running, from the repository root:

```sh
docker compose up --build
```

Open [localhost:5173](http://localhost:5173). Published ports bind to loopback. The current Compose setup does not configure persistent database storage.

## Project structure

- `frontend/`: React app with React Router and TanStack Query.
- `backend/core-domain/`: domain models, behavior, and repository contracts.
- `backend/core-application/`: use cases and transaction port.
- `backend/core-infrastructure-sqlite/`: Exposed persistence and Flyway migrations.
- `backend/service-api-ktor/`: HTTP routes and application wiring.
