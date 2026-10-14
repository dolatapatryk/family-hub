# Family Hub — Product Backlog

## Current product

Family Hub currently brings together shared household tasks, bills with
payment histories, shopping, a 14-day calendar, annual dates, a Today
dashboard, and read-only Google Calendar imports.

The backlog below is prioritized by expected user value and estimated effort.
Effort is relative: **S** = small, **M** = medium, **L** = large.

## P0 — Close core workflows

| Feature | Scope | User value | Effort |
| --- | --- | --- | --- |
| Edit and remove tasks and shopping items — **Completed** | Edit task title, due date, and assignee; edit a shopping item's name, quantity, or store; remove an individual item. | Lets household members correct mistakes without recreating entries. Tasks can currently be completed and archived, while shopping items can be checked off or cleared in bulk. | S–M |
| Disconnect Google Calendar — **Completed** | Stop future syncs, remove stored connection data and imported events, clear client caches, and attempt Google token revocation. | Gives users control over the connection and its data. | M |
| Show Google import freshness to household members — **Completed** | Display the last successful sync and a clear stale or reconnect-required status to viewers of shared imported events. | Helps household members understand whether imported events are up to date, even when they do not manage the integration. | S–M |

## P1 — Increase repeat use

| Feature | Scope | User value | Effort |
| --- | --- | --- | --- |
| Reminders | Optional, per-user notifications for task due dates and upcoming events, with notification preferences. | Helps people remember plans without having to open the app regularly. | M–L |
| Recurring tasks and household routines — **Completed** | Create weekly or monthly chores and routines. Create the first dated task immediately; create the next occurrence when the current one is completed or skipped, with a database constraint preventing duplicate dates. Stop an active series from the Tasks page. Bills are tracked separately because each cycle has payment history. | Reduces the need to re-enter recurring household responsibilities. | L |
| Bills with payment history — **Completed** | Store each bill's next due date, a monthly or two-month interval, optional expected amount and currency, and one dated payment with its actual amount per cycle. Let people adjust a next due date when an invoice arrives, or skip a cycle without marking it paid. Store amounts as integer hundredths while formatting decimal currency values in the UI. Show overdue and current-month bills on Today, and retain paid and skipped history when paused. | Helps the household remember variable-date bills and see what was paid or skipped. | M |
| Recurring calendar events | Support schedules such as a weekly class, including the ability to change or skip one occurrence. | Makes it easier to plan regular activities. Requires careful handling of time zones and exceptions. | L |

## P2 — Expand household collaboration

| Feature | Scope | User value | Effort |
| --- | --- | --- | --- |
| Task priorities, labels, and subtasks | Add lightweight ways to organize work and break larger tasks into steps. | Helps households manage a larger number of tasks. These items are explicitly deferred in the current MVP plan. | M–L |
| Comments and change history | Add discussion and a record of changes to tasks or events. | Helps household members coordinate and understand why a due date or detail changed. | M–L |
| Weekly calendar view and filters | Add a weekly view and filters for events, tasks, and Google imports. | Makes a busier calendar easier to scan and plan. | M |
| Offline changes with a sync queue | Allow users to add or check off items offline, then synchronize when connectivity returns, with clear conflict handling. | Keeps basic workflows available when the network is unreliable. | L |

## Recommended sequence

Editing and removing entries, **Google Calendar disconnect**, **Google
import freshness**, **recurring tasks and household routines**, and
**bills with payment history** are complete. Next, implement
**reminders** for optional per-user notifications.

## Separate release readiness work

Production setup is not a product feature, but it remains necessary before a
production release: configure the production environment, apply migrations,
set Google OAuth credentials and server secrets, deploy the functions, and run
a production smoke test. The project documentation does not confirm that this
work has been completed.
