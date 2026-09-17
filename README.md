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

Feature services, Koin wiring, user selection, Google Calendar, PWA installation, and persistent Docker storage will be added in their respective stages in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). No feature API, credentials, or offline synchronization is included yet.
