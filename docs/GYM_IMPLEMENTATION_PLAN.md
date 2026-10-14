# Siłownia — MVP implementation plan

Status: MVP decisions are confirmed. Template management, plan lifecycle, and
workout entry/history are implemented. The frontend production build passes;
gym-specific automated tests, local database migration checks, and manual
mobile/desktop acceptance checks remain outstanding.
Prepared on 2026-10-10; updated on 2026-10-11.

## 1. Goal and scope

Add **Siłownia** to Family Hub with three connected workflows:

1. Create a reusable training plan template with a duration, training days,
   and an ordered list of single exercises and supersets for each day.
2. Start a personal training plan from a template and see completed weeks/days
   and the next workout. Each user can have at most one active plan.
3. Record a workout for a particular plan/week/day, enter actual reps or
   seconds, optionally override exercise weights, and complete it. Saving a
   completed workout advances that plan atomically.

Use the existing React/TypeScript, React Router, TanStack Query, and Supabase
stack. No new service or third-party dependency is expected.

## 2. Confirmed product decisions

The user confirmed the following MVP requirements:

| Decision | Confirmed MVP behavior |
| --- | --- |
| Weekly structure | The same ordered training days repeat each week. Different weekly schedules are post-MVP. |
| Exercise mode | Each exercise uses reps or time, with time measured in seconds. |
| Target | Reps/time can be fixed or ranged, e.g. `4×8`, `4×8–10`, `4×30s`, or `4×30–45s`. |
| Unilateral exercise | Mark an exercise as unilateral and display its prescription per side, e.g. `4×8/side` or `4×8–10/side`. |
| Load type | Each exercise is weighted or bodyweight, independently of its reps/time mode. |
| Workout entry | Actual reps or seconds are the primary inputs; weight overrides are optional. |
| Weight overrides | Default to one weight per exercise for all sets; allow optional overrides for individual sets. |
| Default weight source | Use weights from the previous completed workout rather than prescribing weights in the template. |
| Actual result granularity | Record actual reps or seconds separately for every set. |
| Unilateral results | Record one result per set applying to each side for MVP; do not sum sides. |
| Visibility | Templates, plans, and workouts are private to their owner. |
| Workout order | Complete days in a fixed sequence, then move to the next week. |
| Superset prescription | Each exercise has its own sets, mode, target, unilateral flag, and load type. Exercises within one superset may have different set counts. |
| Unfinished workout | Persist workout edits when the user clicks **Zapisz**, including repeated saves while training. |

Interpretation of workout saving: **Zapisz** saves the current state without
completing the day; **Zapisz i zakończ trening** saves and advances the plan.
This lets users save after each edit without advancing prematurely. Saves are
explicit button actions; automatic saving on every input change is outside
this MVP. Previously saved edits can be resumed after closing the app.

Additional proposed MVP rules:

- Weeks are progression units, not calendar weeks. Missing a calendar week
  does not skip workouts or expire the plan. Training days are numbered/named
  sessions, not assigned weekdays.
- Record weights in kilograms. Accept decimal comma or decimal point, with
  up to three decimal places; store integer grams. Zero means no added load
  for a weighted exercise; a blank baseline means unspecified. A blank override
  inherits the baseline. Bodyweight is an explicit load type, not an inferred
  zero weight. For MVP, bodyweight exercises have no kilogram inputs.
- For unequal superset set counts, group matching set numbers into rounds.
  An exercise stops appearing after its prescribed sets are exhausted.
  For example, A with 4 sets and B with 3 sets gives three A+B rounds and
  a final A-only round. This display convention is proposed for review;
  the app does not enforce the user's physical exercise execution order.
- Template targets are positive integer reps or seconds. Fixed targets have
  equal minimum/maximum; ranges require minimum <= maximum. Actual results
  are single nonnegative integers in the prescribed mode. Zero records an
  attempted set with zero achieved reps/seconds; blank means unrecorded.
- Actual results can fall below or above the target. Show the target alongside
  the actual result, but do not block completion because a target was missed.
- For unilateral exercises, sets count the prescribed sets for each side,
  not twice that many result rows under the confirmed one-result-for-both-sides
  rule. A timed unilateral exercise displays e.g. `4×30s/side`.
- Saving a completed workout means the entire prescribed day is done.
  Partial completion, skipped exercises/days, and repeating an already
  completed slot are deferred.
- Templates can be edited and archived. An instantiated plan's prescription
  is immutable; template edits apply only to subsequently created plans.
- A user can end an active plan early, preserving its history, before starting
  another. Starting a new plan does not silently replace the existing one.
- Saved workout results and optional weights can be corrected without
  advancing progress again.
  Removing completed workouts or undoing completion is deferred.

## 3. User flows

### Template creation

- **Szablony → Nowy szablon**: enter a name, number of weeks, and number of
  training days per week. Proposed bounds: 1–52 weeks and 1–7 days.
- Generate exactly that many day editors, with optional names such as
  “Góra”, “Dół”, or “Full body”.
- In each day, add an ordered block of type **Pojedyncze ćwiczenie** or
  **Superseria**. Provide move-up/down and remove controls.
- A single block contains one exercise: name, sets, mode (**Powtórzenia** or
  **Czas**), fixed/ranged target, **Jednostronne** flag, and load type
  (**Ciężar** or **Masa ciała**). Weight values belong to workouts, not templates.
- A superset contains at least two exercises, each with its own prescription.
  Allow adding/removing/reordering its exercises. Set counts may
  differ; do not force a common round count or pad an exercise with extra sets.
- Require a nonblank name for every exercise, positive integer sets/targets,
  and at least one valid block per day. Identically named exercises are
  allowed; UUIDs identify exercises, not their names.
- A single target input is the default; **Zakres** reveals minimum/maximum.
  Show reps or seconds explicitly. Changing mode clears the incompatible
  target rather than silently treating reps as seconds.
- Changing the number of days preserves existing day forms. Reducing it
  prompts before discarding populated days.
- Submit the complete template in one operation. Validation errors preserve
  entered values and identify the affected day/block/exercise.

### Plan creation and progress

- From a template, select **Rozpocznij plan**, review its duration and days,
  and optionally change the instance name.
- Copy the template definition into the plan and start at week 1/day 1.
- **Mój plan** shows the name, completed workouts / total workouts, current
  week, next day, and a week-by-day grid.
- Slots are **Do zrobienia**, **W trakcie**, or **Ukończony**. Only the next
  slot can be started, following the confirmed fixed sequence. **W trakcie**
  persists across app sessions.
- Completing the last day advances to the next week. Completing the final
  day of the final week marks the plan completed and frees the active slot.
- **Zakończ plan wcześniej** archives its progress with status `abandoned`.
  Completed/abandoned plans remain accessible through history.

### Workout entry and history

- **Rozpocznij trening** opens the next plan/week/day. An existing draft for
  that slot is resumed rather than duplicated.
- Render the copied day prescription in order, with supersets visually
  grouped and each exercise clearly labeled with its sets, fixed/ranged
  target, time unit, unilateral suffix, and load type.
- For every prescribed set, show an empty actual reps or seconds input next
  to the target. Do not prefill actual results with targets or previous results;
  these would falsely imply that the work was performed.
- For unilateral exercises, label actual inputs **na stronę** under the
  confirmed shared-result rule. Each exercise in a superset uses its own mode;
  a timed exercise can be paired with a rep-based one.
- Show the optional baseline weight as secondary information for weighted
  exercises, initialized from the previous completed workout for that exercise.
  **Zmień ciężar** lets the user override it for the whole exercise.
  This workout default applies to every set without an explicit override.
- Proposed lookup scope: find the most recent earlier completed workout in
  the current plan containing the same stable exercise UUID. This normally
  means the previous week's instance of that training day. Do not match by
  exercise name or use another user's history. With no previous recorded
  weight, leave it unspecified and allow optional first-time entry.
- Carry forward both the default and any per-set overrides, preserving the
  previous weight pattern. Copy them when starting a workout; later changes to
  past workouts cannot alter an existing draft or completed workout. Resume
  saved draft values without refreshing them from history. Reusing weight
  history across different plans/templates is deferred.
- **Osobne ciężary dla serii** expands that exercise's numbered sets. Each
  set can inherit the default or use an explicit weight override. For example,
  a 60 kg default and a 65 kg override for set 3 resolves to 60/60/65/60 kg
  for an exercise with four sets. Changing the default updates inheriting
  sets and preserves explicit overrides; clearing an override restores
  inheritance. Zero is a valid override and must not fall back to the default.
- Require an actual reps/seconds result for every prescribed set before
  completion. Weight is optional and its absence does not block completion.
  Bodyweight exercises have no weight controls; reject weight overrides for
  them server-side. Weighted exercises may retain an unspecified weight.
  Collapsing the per-set controls preserves overrides and displays a summary
  that makes differing weights visible.
- **Zapisz** stores entered values without advancing the plan. Allow repeated
  saves after any edits, including incomplete inputs. Disable save while the
  request is pending and preserve input on failure. Show the last successful
  save; warn
  before leaving with edits that have not been saved.
- **Zapisz i zakończ trening** stores results and advances progress. Disable
  repeated submissions while pending. Show the next day or plan completion
  only after the database confirms success.
- On failure, preserve the form and permit retry. A retry after a lost success
  response must return the existing completion without advancing twice.
- History shows completed date/time, plan, week/day, prescribed exercises,
  and actual results by set, with the original target/mode/side/load labels.
  Show optional weights as one weight when all sets match, otherwise list
  weights by set. Unspecified weights remain visibly unspecified. Correction
  of results keeps the completion timestamp
  and plan progress unchanged.
- The completion date is the user's local date, captured at submission;
  server timestamps also record when the database accepted the completion.

## 4. Data model

Use five tables. Keep template prescriptions as a validated JSON document;
template editing replaces a complete definition, and plans need an immutable
copy. Keep workout results relational for ownership checks and later history
queries. Avoid separate copies of every week when days repeat unchanged.

| Table | Main fields and purpose |
| --- | --- |
| `gym_templates` | `id`, `owner_user_id`, `name`, `weeks_count`, `days_per_week`, `definition`, `definition_version`, `revision`, `archived_at`, timestamps. Reusable source prescription. |
| `gym_plans` | `id`, `owner_user_id`, nullable `source_template_id`, `name`, copied duration/day count, `definition_snapshot`, `definition_version`, `status`, `started_at`, `completed_at`, `abandoned_at`. Fixed prescription and lifecycle. |
| `gym_workouts` | `id`, `plan_id`, `owner_user_id`, `week_number`, `day_number`, `status` (`draft`/`completed`), `revision`, `performed_on`, `started_at`, `completed_at`, timestamps. One workout per plan/week/day. |
| `gym_workout_exercises` | `workout_id`, `owner_user_id`, `exercise_id`, nullable `default_weight_grams`. One result header per prescribed exercise; initialize its default from the previous completed workout. |
| `gym_workout_sets` | `workout_id`, `owner_user_id`, `exercise_id`, `set_number`, nullable `actual_reps`, nullable `actual_seconds`, nullable `weight_override_grams`. One row per prescribed set under the shared-side rule. Null weight inherits the exercise default; zero is an explicit override. |

Resolve each set's recorded weight as
`COALESCE(weight_override_grams, default_weight_grams)`. Saved defaults and
overrides belong to the workout, so template changes cannot alter recorded
weights. Weights may remain null: completion requires actual results rather
than weights. Copy previous weights into these workout-owned fields instead
of resolving them dynamically from historical records.
Persist actual results, default weights, and overrides together in the same
transaction, including when correcting completed workouts.

The definition contains ordered `days`, each with a stable UUID, name, and
ordered `blocks`. Blocks have a UUID, type, and ordered exercises with UUID,
name, sets, `mode` (`reps`/`time`), `target_min`, `target_max`, `unilateral`,
and `load_type` (`weight`/`bodyweight`).
The mode determines whether targets represent reps or seconds. Sets belong
to the exercise, never to the block. Use a TypeScript discriminated union and matching
database validation. A single block must have exactly one exercise; a
superset must have at least two. Reject duplicate UUIDs, unexpected fields,
malformed JSON, mismatched day counts, and oversized payloads.

Database integrity:

- Partial unique index on `gym_plans(owner_user_id)` where `status = 'active'`.
- Unique `(plan_id, week_number, day_number)` on workouts.
- Unique `(workout_id, exercise_id)` on exercise result headers and
  `(workout_id, exercise_id, set_number)` on set results.
- Foreign keys bind workouts to the owning plan and results to the owning
  workout/exercise header; use composite owner keys to prevent cross-user
  parent references. Apply the same RLS and grants to set results.
- Server validation checks slot bounds, prescription exercise IDs, required
  actual results, optional weights, and permitted status transitions. For each
  exercise, require exactly its prescribed set numbers without gaps or extras;
  superset partners may legitimately have different counts.
- A completed reps set must contain `actual_reps` and no `actual_seconds`;
  a timed set must contain `actual_seconds` and no `actual_reps`. Drafts may
  omit actual values, but never provide the wrong mode or both fields. Results
  outside the target range are valid; malformed or negative results are not.
- Prescriptions do not carry kilogram values. Bodyweight workout results
  cannot carry kilogram values; weighted results accept optional weights.
- Index owner/status for plan reads and plan/week/day for workout queries.
- Archive templates rather than cascade-delete plans or history. The source
  template reference is informational; the snapshot is authoritative.

Derive progress from completed workouts: completed slots, completed weeks,
completed count, and the first unfinished slot. Do not maintain a second
client-written progress counter. Under sequential completion, a week is done
when all its days are completed. Drafts do not count toward progress.

## 5. Database API, access, and concurrency

Follow the existing bill operations' pattern: authenticated reads through
PostgREST, writes through transactional database RPCs. No Edge Function is
needed. Proposed operations:

| RPC | Responsibility |
| --- | --- |
| `save_gym_template` | Create/update and validate the entire template; check expected revision on update. |
| `archive_gym_template` | Remove a template from normal selection while preserving references/history. |
| `start_gym_plan` | Authorize template access, copy a coherent snapshot, and enforce one active plan. |
| `abandon_gym_plan` | End the active plan and discard its unfinished draft, retaining completed workouts. |
| `start_gym_workout` | Validate the next slot and create/reuse its draft. On creation, copy previous completed workout weights for each weighted exercise; leave actual results empty. |
| `save_gym_workout_draft` | Validate partial results and update the draft without progress; check revision. |
| `complete_gym_workout` | Validate and save complete results, mark the slot done, and finish the plan if needed. |
| `correct_gym_workout_results` | Correct actual reps/seconds and optional weights without changing slot completion or advancing progress. |

All writes derive ownership from `auth.uid()`. Add RLS to every table and
explicit table-level `SELECT` grants; revoke direct client writes to protected
state. Restrict RPC execution to authenticated users. For privileged functions,
use the repository's empty `search_path` and schema-qualified references, and
perform explicit authorization checks inside every function.

Serialize plan lifecycle/workout writes by locking the parent plan first.
On plan creation, lock the owner's profile row and retain the partial unique
index as the invariant. Lock the template when reading its snapshot so a
concurrent edit cannot produce inconsistent copied metadata.

Completion transaction:

1. Authorize the plan/slot and lock the plan, then the workout if present.
2. If that slot is already completed, return its saved result for an identical
   retry; report a conflict for different results and require the correction
   operation. Check this before rejecting a plan that is now completed.
3. Require an active plan and the next unfinished slot; validate the expected
   draft revision and exact expected exercise/set results. Validate actual
   reps/seconds against the prescribed mode and optional weights against load
   type, including independent set counts within supersets.
4. Save all actual results and optional weights, and mark the workout completed.
5. Derive remaining slots; if none remain, mark the plan completed.
6. Return the workout and current plan progress together.

Concurrent tabs cannot create two active plans or complete two different
slots based on stale progress. Revision checks prevent an older draft save
from overwriting newer input or touching a completed workout. Every failed
operation rolls back all of its changes.

## 6. Frontend integration

Proposed routes:

- `/gym`: current plan and next-workout action; links to templates/history.
- `/gym/templates`: template list with create/edit/archive/start actions.
- `/gym/templates/new` and `/gym/templates/:templateId/edit`: day/block editor.
- `/gym/plans/:planId`: active or historical progress and workout links.
- `/gym/plans/:planId/workouts/:week/:day`: start/resume/complete a workout.
- `/gym/history`: previous plans and completed workouts.

Keep code in `../frontend/src/gym`: `types.ts`, `gym.ts` (pure validation and
progress helpers), `api.ts`, `queries.ts`, pages, and small template/workout
editor components. Use the existing Supabase adapter, `PageHeader`,
`ToastProvider`, form styles, loading/error/empty states, and navigation icon
conventions. Add `frontend/src/styles/gym.css` via `styles.css` only for feature
layout that existing styles cannot cover.

Integrate routes in `../frontend/src/App.tsx` and **Siłownia** in
`frontend/src/layout/AppShell.tsx`. Query keys begin with `['gym', userId]`
and include relevant plan/template/workout IDs. Clear/cancel gym queries on
account changes in `AuthGate.tsx`. Invalidate affected plan/workout/history
queries after mutations; never advance the displayed plan optimistically.

Use vertical exercise cards on phones, integer numeric keyboards for actual
reps/seconds, decimal numeric keyboards for optional weights,
visible superset grouping, explicit labels, and comfortable touch targets.
Provide accessible move-up/down buttons instead of requiring drag-and-drop.
Keep long template forms manageable by switching/expanding one day at a time.

## 7. Delivery sequence and acceptance criteria

1. **Define types and validation.** Use the confirmed decisions and the
   explicit save/finish distinction above. Fix the definition/
   result shape and validation rules. An example template with both single
   exercises and a three-exercise superset with unequal set counts, mixed modes,
   ranges, and unilateral exercises is valid.
2. **Implement database foundation.** Add ordered migrations for tables,
   constraints, RLS/grants, validation, and RPCs. Two users in the same household
   have independent active plans and cannot access one another's private data.
3. **Build template flows.** Implement listing, creation, editing, and
   archiving. Nested exercise forms preserve order and reject invalid blocks.
4. **Build plan flows.** Start from a snapshot, show the week/day grid, enforce
   one active plan, and allow ending a plan early. Template edits leave existing
   plans unchanged.
5. **Build workout flows.** Start/resume, record actual reps/seconds, optionally
   override weights, save draft repeatedly, complete transactionally, review
   history, and correct results. Completing the last workout completes the
   plan; retrying never advances twice.
6. **Verify and document.** Run frontend tests/build, database tests, and phone/
   desktop smoke checks. Update README with behavior and migration steps.
   Apply migrations to the target test environment before enabling the UI;
   production rollout remains a separate environment-specific step.

## 8. Verification plan

Add `frontend/tests/gym.test.mjs` using the existing Node test runner for
meaningful domain cases: template validation, reps/time target ranges,
unilateral prescription formatting, actual results below/within/above targets,
mixed-mode superset grouping, weight input
parsing (including blank vs zero), default/override resolution, changing defaults
without erasing overrides, restoring inheritance, unequal superset set counts,
progression across week boundaries, and final completion. Cover API error
propagation and query ownership where useful.

Add `supabase/tests/gym.test.sql` with pgTAP coverage for ownership/RLS and
grants, invalid prescriptions/results, template snapshot stability, duplicate
active plans, duplicate workout slots, draft-vs-completion behavior, full
rollback on invalid weights, stale revisions, idempotent completion (including
the final workout), correction without progression, and abandoning plans.
Also cover inherited and overridden set weights, explicit zero overrides,
optional missing weights, missing/extra set rows, and supersets with unequal
set counts. Cover wrong-mode/both-mode actual values, zero vs blank results,
missing actual values on completion, below/above-target results, bodyweight
weight rejection, and fixed/ranged rep/time prescriptions.
Cover previous-workout weight lookup, first workouts without known weights,
carrying per-set differences, ignoring drafts as a history source, and preserving
copied weights after an earlier workout is corrected. Assert that actual
reps/seconds are never copied from previous results.
Use two real database sessions for the races that a single pgTAP transaction
cannot demonstrate: simultaneous plan starts and workout completions.

Manual end-to-end example: create a 2-week/2-day template containing a weighted
`4×8–10/side` exercise and a mixed-mode/bodyweight superset with unequal set
counts, including `4×30–45s`; start it; record actual reps/seconds for each set
including values outside targets; leave optional weights unspecified; override
weights including zero and a decimal; change a default and verify inheritance
and override preservation;
save a partial workout, edit and save again, close/reopen and resume; confirm
these saves do not advance the plan; complete all four workouts; verify week
rollover, previous weights carried into week 2 with actual results still empty,
completion, and history; start another plan. Edit/archive the source
template and confirm prior prescriptions/results are unchanged. Also check
failed submissions, lost-response retries, stale tabs, account switching,
mobile form layout, and keyboard operation.

Implementation checks: `npm test` and `npm run build` in `../frontend`, then
`npx supabase test db` from the repository root with local Supabase available.
No tests need to run for this planning-only change.

## 9. Deferred features

Exercise catalogue, public/shared template library,
calendar scheduling/reminders, different schedules/progression per week,
timers/rest periods, automatic load suggestions, charts/personal records,
RPE/failure targets, assisted-load conventions, partial/skipped/repeated workouts,
separate unilateral side results, weight-history matching across plans/templates,
changing an active plan's
prescription, undoing completions, and offline synchronization.

The current PWA caches the app shell; Supabase writes require a connection.
Draft persistence in this plan means a confirmed online database save. Offline
entry synchronization is a separate feature.
