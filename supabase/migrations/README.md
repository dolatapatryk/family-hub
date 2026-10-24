# Fresh-install migrations

These eight migrations define the complete application schema for a new Supabase
database. They replace the previous 42-file migration history. Apply them in
filename order; Supabase supplies the Auth schema and database roles.

| Migration | Domain |
| --- | --- |
| [households](20261024203617_households.sql) | Households, profiles, membership helper, onboarding and invitations; shared `private` schema |
| [shopping](20261024203618_shopping.sql) | Shopping items, text normalization and member access |
| [tasks](20261024203619_tasks.sql) | Tasks, recurring rules and automatic occurrence advancement |
| [calendar](20261024203620_calendar.sql) | Native events and annual dates |
| [google_calendar](20261024203621_google_calendar.sql) | Connections, OAuth, calendar selection, synchronization and imported events |
| [bills](20261024203622_bills.sql) | Recurring bills, payments and skipped cycles in one history table |
| [gym](20261024203624_gym.sql) | Templates, plans, workouts and sets |
| [finance](20261024203625_finance.sql) | Budgets, categories, savings, plans, projects, wallets and transactions |

Each domain contains its tables with final constraints, indexes, functions,
triggers, RLS policies and explicit API grants. Dependencies are created before
their users; function-body validation remains enabled. The Finance migration
also enables `pgcrypto` in `extensions` for operation fingerprints.

Fixes are part of the initial definitions, including shopping normalization,
gym JSON validation, Google sync leases, bill cycle history, signed wallet
opening balances, multi-select transaction filters and function-level
`Europe/Warsaw` timezone settings. Removed tables, obsolete function versions,
data backfills and dynamic function rewrites are omitted.

This is a replacement baseline, not an upgrade for a database that has already
applied the old migration history. Historical migration names in the implementation
plans document earlier work; the files above are the current source of truth.

## Verification

For a disposable local Supabase instance (reset deletes its data):

```sh
npx supabase db reset --local
npx supabase test db --local
```

The consolidation was verified on PostgreSQL 17 by applying the original history
and the new migrations to separate empty databases with the same Supabase Auth
schema and default grants. Their application schema definitions and privileges
match, including function settings, constraints, indexes, triggers, policies,
column grants and view security options. All 334 pgTAP assertions in the 14 SQL
test files passed against the consolidated schema.
