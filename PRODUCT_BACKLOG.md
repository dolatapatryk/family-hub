# Family Hub — Product Backlog

## Current product

Family Hub currently brings together shared household tasks and shopping, a
14-day calendar, annual dates, a Today dashboard, and read-only Google Calendar
imports.

The backlog below is prioritized by expected user value and estimated effort.
Effort is relative: **S** = small, **M** = medium, **L** = large.

## P0 — Close core workflows

| Feature | Scope | User value | Effort |
| --- | --- | --- | --- |
| Edit and remove tasks and shopping items | Edit task title, due date, and assignee; edit a shopping item's name, quantity, or store; remove an individual item. | Lets household members correct mistakes without recreating entries. Tasks can currently be completed and archived, while shopping items can be checked off or cleared in bulk. | S–M |
| Disconnect Google Calendar | Stop future syncs, remove stored connection data and imported events, clear client caches, and attempt Google token revocation. | Gives users control over the connection and its data. This feature is already documented as deferred until after the MVP. | M |
| Show Google import freshness to household members | Display the last successful sync and a clear stale or reconnect-required status to viewers of shared imported events. | Helps household members understand whether imported events are up to date, even when they do not manage the integration. The implementation plan identifies this as a product gap. | S–M |

## P1 — Increase repeat use

| Feature | Scope | User value | Effort |
| --- | --- | --- | --- |
| Reminders | Optional, per-user notifications for task due dates and upcoming events, with notification preferences. | Helps people remember plans without having to open the app regularly. | M–L |
| Recurring tasks and household routines | Create repeating chores or obligations, such as weekly cleaning or monthly bills; define how each next occurrence is created and prevent duplicates. | Reduces the need to re-enter recurring responsibilities. | L |
| Recurring calendar events | Support schedules such as a weekly class, including the ability to change or skip one occurrence. | Makes it easier to plan regular activities. Requires careful handling of time zones and exceptions. | L |

## P2 — Expand household collaboration

| Feature | Scope | User value | Effort |
| --- | --- | --- | --- |
| Task priorities, labels, and subtasks | Add lightweight ways to organize work and break larger tasks into steps. | Helps households manage a larger number of tasks. These items are explicitly deferred in the current MVP plan. | M–L |
| Comments and change history | Add discussion and a record of changes to tasks or events. | Helps household members coordinate and understand why a due date or detail changed. | M–L |
| Weekly calendar view and filters | Add a weekly view and filters for events, tasks, and Google imports. | Makes a busier calendar easier to scan and plan. | M |
| Offline changes with a sync queue | Allow users to add or check off items offline, then synchronize when connectivity returns, with clear conflict handling. | Keeps basic workflows available when the network is unreliable. | L |

## Recommended sequence

Start with **editing and removing entries**, **Google Calendar disconnect**, and
**Google import freshness**. These improve everyday use and complete the control
surface for the existing integration. Next, validate whether users need
**reminders** or **recurring tasks** more urgently.

## Separate release readiness work

Production setup is not a product feature, but it remains necessary before a
production release: configure the production environment, apply migrations,
set Google OAuth credentials and server secrets, deploy the functions, and run
a production smoke test. The project documentation does not confirm that this
work has been completed.
