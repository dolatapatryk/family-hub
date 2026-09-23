# Family Hub

A shared family app built with React, TypeScript, Vite, and Supabase. Users
can sign in, create a household, manage shared Tasks and Shopping data, and
use the upcoming Today and Calendar views.

## Local development

Requires Node.js 22.12+ and the Supabase CLI.

Start the local Supabase project from the repository root:

    npx supabase start

Copy the frontend environment template and fill in the publishable key shown
by npx supabase status:

    cp frontend/.env.example frontend/.env.local

Start the frontend in another terminal:

    cd frontend
    npm ci
    npm run dev

Open [localhost:5173](http://localhost:5173). Supabase Auth and Postgres run
locally on the ports reported by the Supabase CLI.

Local and hosted Supabase projects have separate Auth users. The first
authenticated user can create a household from the onboarding screen. Never
put a Supabase secret or service-role key in frontend environment variables.

## Configuration

Frontend values are read at build time:

| Variable | Purpose |
| --- | --- |
| VITE_SUPABASE_URL | Supabase API URL, usually http://127.0.0.1:54321 locally |
| VITE_SUPABASE_PUBLISHABLE_KEY | Publishable/anon key from npx supabase status or the Supabase dashboard |
| DEV_ALLOWED_HOSTS | Optional comma-separated development hostnames without scheme, port, or path |

Restart Vite after changing .env.local.

## Access over Tailscale

To share the development frontend over Tailscale, keep the host awake and
make sure the client can reach both the Vite server and the configured
Supabase URL:

    tailscale ip -4
    tailscale serve --bg http://127.0.0.1:5173

Set DEV_ALLOWED_HOSTS to the machine's Tailscale hostname before restarting
Vite. For a remote device, use a hosted Supabase project or configure the
local Supabase API to be reachable from the tailnet.

## Checks

    cd frontend
    npm test
    npm run build

Reset the local Supabase database when testing migration changes:

    npx supabase db reset

## Project structure

- frontend/: React application, authentication, feature pages, and Supabase adapters.
- supabase/: local Supabase configuration and migrations.

Today and Calendar are currently placeholders. The implementation roadmap is
in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
