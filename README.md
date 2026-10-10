# Family Hub

A shared family app built with React, TypeScript, Vite, and Supabase. Users
can sign in, create or join a household, manage shared Tasks and Shopping,
and keep one-off events and annual dates in a Supabase-backed calendar.

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

## Google Calendar development setup

Google Calendar uses three Edge Functions. The authenticated management and
sync functions require a signed-in Supabase user. The Google callback has JWT
verification disabled because Google cannot send the user's Supabase bearer
token; it accepts only a short-lived, one-use state hash stored for the current
member. No Edge Function returns Google tokens or raw Google event payloads to
the browser; Calendar and Today load only the normalized, RLS-protected mirror.

To configure a development connection:

1. Create a Google OAuth Web client, enable the Google Calendar API, and add
   the local callback URL below as an authorized redirect URI. Add both
   read-only scopes to the consent screen:
   `calendar.events.readonly` and `calendar.calendarlist.readonly`.
2. Copy `supabase/functions/.env.example` to the ignored file
   `supabase/functions/.env.local`. Fill in the Web client ID and secret, then
   generate a token-encryption key with `openssl rand -base64 32`. Keep the
   callback URL and frontend URL exact; their local defaults are shown in the
   example file.
3. Start Supabase and apply pending local migrations with
   `npx supabase migration up --local`. Then serve the functions with
   `npx supabase functions serve --env-file supabase/functions/.env.local`.
   Run Vite at `http://localhost:5173` and sign in to a local Family Hub
   account before connecting Google.
4. For a hosted Supabase project, register its exact
   `https://<project-ref>.supabase.co/functions/v1/google-calendar-callback`
   URL in Google Cloud and store the same server variables in that project's
   Edge Function secrets. Apply pending database migrations before deploying
   the functions. Do not put any of these values in `frontend/.env.local` or
   `VITE_*` variables.

`GOOGLE_CALENDAR_ALLOWED_ORIGINS` is the comma-separated browser-origin
allowlist for the management function. `GOOGLE_CALENDAR_FRONTEND_URL` is the
fixed page that receives a generic connection result after OAuth. The
`GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEYS` JSON map is keyed by the stored key
version; retain older keys there while encrypted credentials still use them.
For a Google consent screen in Testing status, refresh-token lifetime is
limited, so reconnect behavior needs to be checked during development.

The Calendar page lets a member connect their account, load the Google calendar
list, select calendars, and set each selected calendar to Private or Household.
**Importuj wydarzenia** starts a user-requested import for all selected
calendars; **Synchronizuj teraz** fetches later changes and deletions. The first
import includes ongoing and future one-off events. Recurring events are skipped.
Imported events appear read-only in Calendar and Today, with a link back to
Google when one is available. Opening either page reads the saved event mirror
and sync status without starting Google synchronization.
Household members also see when shared imports last completed and whether an
import is running, may be out of date, has lost Google access, or needs the
owner to reconnect the account.

The sync worker checkpoints each Google page and its imported rows together, so
a later click can resume a run after a temporary failure or closed page. An
initial import does not backfill completed history; later syncs retain imported
events after they pass. Each calendar's sharing setting applies to all its
imported details.

From Calendar settings, the connection owner can disconnect Google. Family Hub
deletes the stored connection and all imported events, clears the local event
cache, and attempts to revoke the refresh token with Google. If Google does not
confirm revocation, local data is still removed and the settings page reports
that remote revocation was not confirmed. Disconnecting does not change
original events in Google.

## Calendar and annual dates

**Kalendarz** displays a 14-day agenda with one-off events, annual occurrences,
and active tasks with due dates. Create, edit, and delete normal events there.
Timed events store start/end instants and an IANA time zone; the agenda shows
times in the viewer's browser time zone. All-day events store date-only values.
The form's last day is inclusive; the database stores an exclusive end date.
The timed form rejects nonexistent or repeated hours during a daylight-saving
transition rather than silently choosing an instant.

**Ważne daty** has a separate form and list for birthdays, anniversaries, and
other annual dates. Birthdays and anniversaries store their full initial date
and first appear a year later, with the calculated birthday/anniversary number.
Other dates store only month/day. Occurrences are generated in memory for
Calendar and Today; no yearly copies are inserted. February 29 uses February
28 in non-leap years. Edit or delete annual definitions only in **Ważne daty**.

New items default to private. Household members can read, edit, and delete
shared items; private items are accessible only to their creator. Only the
creator can change visibility. RLS and column grants enforce these rules in
both `calendar_events` and `annual_dates`. Calendar query keys also include the
current user to keep private cached items separate after an account switch.

The schema is defined in
`supabase/migrations/20260928000000_create_calendar_schema.sql`. This migration
has been applied and manually verified on the test database. Apply it and
verify it separately in each staging or production Supabase project before
using these features there.

Manual checks of the household, calendar, and Google Calendar flows on the
test database, plus the phone and desktop layouts, have been reported complete.
Automated coverage includes task behavior, calendar and annual-date logic,
Google request/event normalization, and database RLS. Worker retry, lease,
concurrency, and expired-sync-token recovery still need dedicated tests.

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
    cd ..
    npx supabase test db

`npm test` runs the frontend regression suite. `npx supabase test db` runs the
pgTAP RLS and sync-lifecycle suites in `supabase/tests/` against the local
Supabase database. The user reports that the product flows were also checked
manually on the test database and that the app was checked on phone and desktop.

Reset the local Supabase database when testing migration changes:

    npx supabase db reset

## Project structure

- frontend/: React application, authentication, feature pages, and Supabase adapters.
- supabase/: local Supabase configuration and migrations.

Today shows today's tasks and visible calendar events, including annual
occurrences and imported Google events. Google Calendar's OAuth,
calendar-selection, user-triggered synchronization, and imported-event display
code and migrations have been manually exercised on the test database,
according to the user. Disconnect code and its migration are implemented but
have not yet been manually verified there. Production OAuth credentials,
function secrets, migrations, deployment, and a production smoke test remain
environment-specific rollout work. The detailed roadmap is in
[GOOGLE_CALENDAR_IMPLEMENTATION_PLAN.md](GOOGLE_CALENDAR_IMPLEMENTATION_PLAN.md).
