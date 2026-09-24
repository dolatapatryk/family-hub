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

To use the development app from another device on the same Wi-Fi, open
`http://<computer-LAN-IP>:5173` (for example, `http://192.168.1.62:5173`).
The Vite development and preview servers proxy Supabase requests to the
configured `VITE_SUPABASE_URL`, so the phone does not need to reach the
computer's local `127.0.0.1:54321` address directly. For a build configured
with a hosted Supabase URL, the app connects to that URL directly.

Local and hosted Supabase projects have separate Auth users. The first
authenticated user can create a household from the onboarding screen. To add
another person, an existing member opens **Domownicy**, creates a one-time
invite code, and shares it with them. The code expires after 24 hours. The
invitee signs in or creates an account, chooses **Mam kod zaproszenia**, and
enters the code during onboarding. Invite records stay in the private database
schema; the browser can only create or redeem a code through authenticated
database functions. Never put a Supabase secret or service-role key in
frontend environment variables.

## Configuration

Frontend values are read at build time:

| Variable | Purpose |
| --- | --- |
| VITE_SUPABASE_URL | Supabase API URL, usually http://127.0.0.1:54321 locally |
| VITE_SUPABASE_PUBLISHABLE_KEY | Publishable/anon key from npx supabase status or the Supabase dashboard |
| DEV_ALLOWED_HOSTS | Optional comma-separated development hostnames without scheme, port, or path |

Restart Vite after changing .env.local.

## PWA and deployment

The production build is an installable PWA. To inspect it locally, build and
serve the static output:

    cd frontend
    npm run build
    npm run preview

The service worker is enabled for production builds and is served at the site
root. It caches the app shell and versioned Vite assets; Supabase data still
needs a network connection. Keep the app at the domain root, or update the
manifest start URL, scope, service worker registration, and asset paths before
deploying it below a path. Browsers require HTTPS for installation outside
localhost. If you change the fixed app-shell assets, increment `CACHE_NAME` in
`frontend/public/sw.js` so installed copies replace the previous shell cache.

For a hosted build, set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` in the build environment. These values are
compiled into the frontend; use only the publishable key. In Supabase Auth,
set the Site URL to the deployed app origin and allow that origin in the
redirect URL list for the environment. Configure each preview and production
environment separately. The `frontend/Dockerfile` builds the static app and
serves it through the included Nginx configuration, which keeps the app shell
and service worker revalidating while allowing fingerprinted Vite assets to
use long-lived caching.

When checking a release on a phone, confirm the app can be installed and
reopened in standalone mode, navigation and account controls have comfortable
touch targets, and content remains inside the cutout and home-indicator areas.
Check both portrait and landscape layouts. Going offline can load the cached
shell, but app data and writes remain unavailable until Supabase can be
reached.

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
