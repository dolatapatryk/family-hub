# Finance transactions, physical wallets, and savings goals

Prepared: 2026-10-13. Updated: 2026-10-14.
Status: implementation proposal; no application or database changes have been made for this feature.

## 1. Outcome and agreed domain model

Add **Finanse → Transakcje**, a monthly record of actual income, expenses,
transfers, and amounts set aside. Reuse existing transaction categories.
The UI remains Polish; this implementation plan is written in English.

Keep three concepts distinct:

1. **Wallet:** where money physically resides, such as a bank account or cash.
2. **Savings activity:** how much was newly set aside through a physical transfer
   or spent from existing savings during a month.
3. **Savings goal:** what money is intended for, such as an emergency fund.

A wallet can hold money for several goals. A goal can span several wallets.
Consequently, a wallet must not have a single `goal_id`, and a goal's children
must not each create another copy of the same physical wallet.

Example of the eventual allocation view:

| Purpose | Bank account A | Bank account B | Total |
| --- | ---: | ---: | ---: |
| Emergency fund | PLN 15,000 | PLN 10,000 | PLN 25,000 |
| Holidays | PLN 5,000 | PLN 2,000 | PLN 7,000 |
| Unallocated cash | PLN 3,000 | PLN 0 | PLN 3,000 |
| Physical balance | PLN 23,000 | PLN 12,000 | PLN 35,000 |

Do not add goal balances to wallet balances when calculating total money.

### Delivery boundary

**Release 1:** physical wallets, monthly transactions, categorization, transfers,
and explicit monthly savings activity. Existing Savings remains independent.

**Release 2:** optional goal allocation, reconciliation of the existing savings
hierarchy, and a single source of truth for linked goal balances.

Release 1 must not automatically create transactions in
`finance_savings_transactions`, infer goals from names, or combine the old
Savings total with the new wallet total. Show a short explanation in Savings:
“Cele oszczędnościowe są na razie prowadzone niezależnie od portfeli.”

Budget-versus-actual reporting is a subsequent enhancement. Existing Budget
calculations are not silently reinterpreted as a formal planning system.

### Confirmed simplifications (2026-10-14)

- Setting money aside always involves a transfer between two physical wallets.
  There is no balance-neutral saving/earmarking transaction.
- Spending existing savings reduces physical money but is reported separately
  from regular expenses and does not reduce the monthly operating balance.
- Categories use their current classification; do not store a historical section
  snapshot on a transaction.
- Every transaction has one amount and one funding treatment. A purchase partly
  funded by savings is entered as separate transactions, usually from two wallets.

## 2. Existing implementation to reuse

| Existing code/data | Use in this feature |
| --- | --- |
| `../frontend/src/finance/navigation.ts` | Add Transactions routes and secondary navigation |
| `../frontend/src/finance/FinancePage.tsx` | Integrate the feature without requiring a budget month |
| `../frontend/src/finance/categories.ts` | Reuse category sections, parent relationships, and labels |
| `../frontend/src/finance/types.ts`, `money.ts` | Exact minor-unit money and browser decimal-string contracts |
| `../frontend/src/finance/api.ts`, `useFinanceAction.ts` | API/error/version-conflict conventions |
| `FinanceCharts.tsx` and existing styles | Reuse card, chart, dialog, and responsive patterns where suitable |
| `finance_categories` | Shared category definitions; do not create a duplicate taxonomy |
| `finance_savings_accounts`, `finance_savings_transactions` | Legacy goals/history; unchanged in Release 1 |
| `private.finance_operation_receipts` and household locks | Idempotent mutations and concurrency conventions |
| `../supabase/tests` and `frontend/tests/` | Database and frontend regression suites |

The checked-in source already supports savings-account hierarchies, shared and
private visibility, signed movements, and paired savings transfers. These do
not establish a reliable mapping to physical wallets. The current categories
also include personal allowances represented as `saving` with
`allocation_role = 'personal_allowance'`; these are not ordinary savings.

Treat older implementation-plan status statements as historical. Check actual
migration state in the target environment before implementing or deploying.

## 3. Accounting and reporting rules

### 3.1 Transaction kinds

Use one authoritative transaction record, including both endpoints for a
transfer. Derive signed wallet movements in a read query; do not persist a
second, independently editable transfer leg.

| Kind | Wallet effect | Monthly income/expenses | Savings activity |
| --- | --- | --- | --- |
| `income` | Increase destination | Increase income | None in Release 1 |
| `expense` | Decrease source | Increase regular expenses | None |
| `savings_expense` | Decrease source | Excluded | Increase savings used by the full amount |
| `refund` | Increase destination | Reduce expenses in the refund month | None in Release 1 |
| `savings_refund` | Increase destination | Excluded | Reduce savings used by the full amount |
| `transfer` | Decrease source; increase destination equally | Neither | Full-amount contribution or none |
| `opening` | Establish signed starting balance | Neither | None |
| `adjustment` | Apply signed balance correction | Neither | None |

`saving` is a category classification, not an expense kind. Selecting a standard
saving category switches the form to saving money: require two different wallets
and default to a full-amount savings contribution. Moving already saved money
uses an ordinary transfer with no contribution effect. There is no option to
leave money in the same wallet and merely count it as newly saved.

`savings_expense` is a real outgoing payment funded entirely by existing savings.
Its category can still describe what was bought, but its kind keeps it out of
regular monthly expenses. `savings_refund` is the symmetric return of such a
payment: it restores cash and reduces savings used, without increasing income,
the monthly balance, or newly saved contributions.

Examples:

- Salary of PLN 9,000: income to the current account.
- Groceries of PLN 180: expense from that account, categorized as food.
- Set aside PLN 1,000: transfer to another wallet, marked as a contribution.
- Move existing savings between banks: ordinary transfer, no new savings.
- Later assign that PLN 1,000 to the emergency fund: allocation only, no new contribution.
- Spend PLN 200 of savings: `savings_expense`, excluded from monthly regular expenses.
- Move PLN 200 from the savings wallet to the current account before paying:
  ordinary transfer, followed by a `savings_expense` from the current account.
  Count savings usage only at the outgoing payment, never on the preparatory transfer.
- Pay PLN 500 using PLN 300 of current funds and PLN 200 of savings: enter an
  `expense` of PLN 300 from wallet A and a `savings_expense` of PLN 200 from wallet B.
  If both parts were paid from one wallet, two records may reference that same wallet.

The whole-transaction choice is explicit: “Wydatek bieżący” or “Wydatek z
oszczędności”. Do not infer it from the wallet's name/type or the price of a
purchase. A wallet may contain both current funds and savings. Release 1 does not
automatically track the funding provenance of money transferred into that wallet.

Release 1 savings activity is user-declared. It is not yet a tracked reserve
balance and cannot prove that savings spending came from an earlier contribution.
Do not label every unassigned wallet balance as savings. Release 2 adds the
reserve/allocation controls needed for that distinction.

### 3.2 Category compatibility

- Income requires an `income` category.
- Both expense kinds and both refund kinds require `fixed_expense` or
  `variable_expense` categories. Category describes the purchase; transaction kind
  determines whether it affects the regular monthly balance.
- A contribution requires a standard `saving` category and always uses the full
  transfer amount. Mixed-purpose movements must be entered as separate records.
- An existing-savings transfer may retain a saving category but must explicitly
  have no contribution effect. Category selection defaults the effect in the
  form; it does not override an explicit existing-savings choice.
- Ordinary transfers need no category. Personal-allowance categories are allowed
  on transfers but contribute zero to “Odłożono”.
- Investment-category operations in Release 1 are transfers between tracked
  PLN wallets, excluded from consumption and savings contribution metrics.
  Securities purchases, valuations, and investment performance are deferred.
- Do not silently treat an outgoing payment to an untracked destination as an
  internal transfer. Require creation of the physical destination wallet.
- Category rename/reparent keeps the relationship. Prevent category deletion
  while referenced. Resolve section/group labels from the current category:
  section changes intentionally update historical category grouping. Do not store
  a section snapshot. Keep accounting behavior explicit in kind/savings effect;
  category edits must not turn past expenses into transfers or create savings.
  Block category-section changes incompatible with referenced transaction kinds;
  changes between compatible expense sections remain allowed. Invalidate category
  reports when definitions change.
- Refunds are positive input amounts with explicit `refund` or `savings_refund`
  kind, not negative income. Original-expense linking and cumulative-refund
  validation are deferred; Release 1 allows standalone refunds using the expense
  category and actual date. The form requires the original funding treatment so
  returning a savings-funded purchase cannot inflate the monthly balance.

### 3.3 Monthly calculations

Month is a date range `[month_start, next_month_start)`, independent of
`finance_months`. Use date-only transaction dates, not UTC midnight timestamps.
Disallow future actual transactions in Release 1; planned transactions remain
outside this feature. Allow backdating on/after the wallet's opening date.

For the selected scope and month:

- **Przychody:** sum of income.
- **Wydatki bieżące:** `expense` minus `refund`.
- **Bilans miesiąca:** income minus net regular expenses; transfers and savings-funded
  spending/refunds excluded. Label its description “Przychody minus wydatki bieżące”.
- **Odłożono:** full amounts of transfers explicitly marked as contributions, once each.
- **Wydatki z oszczędności:** `savings_expense` minus `savings_refund`.
- **Zmiana oszczędności:** contributions minus net savings-funded spending; secondary
  activity detail, not a reconciled savings balance in Release 1.
- **Wydatki łącznie:** net regular expenses plus net savings-funded spending;
  secondary detail to make total outgoing spending visible.
- **Saldo na koniec miesiąca:** all signed wallet movements before next month.
  For the current month label this “Saldo na dziś”.

Never label income minus regular expenses as the available wallet balance or
total cash flow. Savings-funded spending still reduces wallet balances and total
money. Never subtract contributions again from the main monthly balance. A
separate future budget availability metric would need its own definition.

Wallet filters apply to transactions touching that wallet. Transfers remain
excluded from income/expenses even when only one endpoint is selected. Attribute
savings contributions to the destination wallet, savings spending to its source,
and savings refunds to their destination. An outgoing contribution transfer therefore
appears in source-wallet history but counts toward the destination's savings
metric. Explain this rule in the metric tooltip.

History counts each transfer once. Opening/correction records remain visible
with distinct badges but are excluded from the ordinary transaction count.
Category filtering affects history and category results; keep monthly KPI cards
at month + visibility + wallet scope and label the filtered list separately.

The default category table shows net regular spending, including negative categories when refunds
exceed expenses. A donut cannot display negative slices: use positive net
categories only, label it accordingly, and show net refunds separately.
Never add parent subtotals to leaf values a second time.
Provide a separate savings-funded spending view with the same category breakdown;
never silently mix it into the regular-expense chart.

## 4. Release 1 database design

The following names and contracts are proposed, not existing migrations.
Reuse `public.finance_minor_units` and UUID IDs. Serialize money as strings,
never JavaScript floating-point values.

Mutable tables use the existing metadata convention: `id`, `household_id`,
`created_by`, `created_at`, `updated_at`, `version`. Include
`UNIQUE (household_id, id)` for composite references.

### 4.1 `public.finance_wallets`

| Field | Type / rule |
| --- | --- |
| Common metadata | As above |
| `name` | Nonblank text, maximum 120 characters |
| `wallet_type` | `bank`, `cash`, `savings_bank`; descriptive, never changes accounting |
| `currency` | Text, constrained to `PLN` in Release 1 |
| `visibility` | `household` or `private` |
| `owner_user_id` | Required authenticated owner; validated against household membership |
| `opened_on` | Finite date; earliest supported transaction date |
| `is_archived` | Boolean, default false |
| `color`, `icon` | Optional validated presentation values |

No `parent_id`, `goal_id`, or mutable current-balance field. Wallets are flat
physical entities. Their balance is calculated from transactions.

Creation accepts an opening balance and atomically creates one `opening`
transaction, including zero. Its date equals `opened_on`. Opening-date/balance
corrections use a dedicated versioned action with a preview; ordinary users
cannot create additional opening records. Later reconciliation uses dated
`adjustment` records with a required reason, not an overwritten opening balance.

Negative balances are allowed and highlighted: users may be entering incomplete
history or representing an overdraft. Dedicated credit-card debt, limits, and
statements are outside Release 1.

Archive rather than delete wallets with financial history. Archiving does not
remove money from total balances or historical reports. Active-wallet pickers
exclude archived wallets; the wallet list has an archived section. Require a
zero current balance to archive in Release 1. Restore before editing its history.

### 4.2 `public.finance_transactions`

| Field | Type / rule |
| --- | --- |
| Common metadata | As above |
| `kind` | `income`, `expense`, `savings_expense`, `refund`, `savings_refund`, `transfer`, `opening`, `adjustment` |
| `transaction_date` | Finite date |
| `amount_minor` | Positive minor units except signed opening/adjustment; zero only for opening |
| `source_wallet_id` | Nullable same-household FK |
| `destination_wallet_id` | Nullable same-household FK |
| `category_id` | Nullable same-household FK to existing categories |
| `description` | Optional text, maximum 2,000 characters |
| `savings_effect` | `none` or `contribution`; contribution is valid only for a transfer and applies to its whole amount |

`amount_minor` is the only monetary amount on a transaction. Savings spending is
derived from `savings_expense` / `savings_refund` kinds, not from a second amount
or a withdrawal flag. The savings effect distinguishes new contributions from
ordinary transfers of already saved money.

Endpoint constraints:

- Income and both refund kinds: destination only; balance effect `+amount_minor`.
- Both expense kinds: source only; effect `-amount_minor`.
- Transfer: two different wallets; equal opposite effects.
- Opening/adjustment: destination only; signed amount is the balance effect.

Use row CHECK constraints for the kind/endpoint/amount/savings-effect matrix,
a partial unique index for one opening per wallet, and composite foreign keys
for household integrity. Validate category compatibility, opening-date bounds,
wallet lifecycle, and endpoint permissions within the database mutation layer.
Enforce `savings_effect = 'none'` for every non-transfer. For contribution
transfers, validate a standard saving category. Corrections require a description.
Reject invalid combinations instead of silently normalizing them.

There is no separate transfer table or persisted movement table. Both endpoints
are updated by modifying a single versioned transaction. A read projection uses
`UNION ALL` to produce signed movements for balance aggregation. Savings metrics
aggregate transaction headers, never those derived transfer legs.

### 4.3 Indexes and queries

- Wallets: `(household_id, visibility, owner_user_id)` for visible-wallet reads.
- Transactions: `(household_id, transaction_date DESC, id DESC)` for month/history.
- Endpoint indexes: `(household_id, source_wallet_id, transaction_date, id)` and
  `(household_id, destination_wallet_id, transaction_date, id)` for balances and filters.
- Category FK index: `(household_id, category_id, transaction_date)`.
- Partial unique opening index on `(household_id, destination_wallet_id)` where
  `kind = 'opening'`.

Use keyset pagination with `(transaction_date, id)` and a page size of 50.
Compute totals and category summaries in the database across the full filtered
dataset, never from the loaded history page. Fetch the KPI/category summary in
one request for a consistent snapshot. Keep balance queries separate from
month-only activity queries: balances require all earlier movements.
Check query plans on realistic fixtures before adding further indexes/caches.

## 5. Authorization, mutations, and API

### Visibility defaults for Release 1

- Household members can read/write shared wallets and their transactions.
- Private wallets and their history belong to their owner only.
- A transaction is readable/writable only if every endpoint is accessible.
- Initially allow transfers only between shared wallets, or private wallets of
  the same owner. Mixed shared/private transfers are deferred: hiding an entire
  transfer from one audience would otherwise make the shared balance incorrect.
- Wallet visibility is fixed after creation in Release 1. A later change needs
  an explicit history/audience migration, not just a toggle.
- Scope selector: `Domowe`, `Moje`, `Wszystkie dostępne`; default `Domowe`.
  Aggregates, counts, dropdowns, receipts, and search obey that scope and RLS.

Enable RLS on new exposed tables, configure grants explicitly, and do not expose
direct client writes that bypass multi-record validation. Prefer invoker reads
and `security_invoker` views. If mutations require privileged helpers to follow
the existing RPC-only write model, place those helpers in `private`, restrict
execution, set a safe search path, and explicitly validate actor, membership,
and endpoints. Do not solve an RLS failure by broadly granting privileges.
These choices follow the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [database function guidance](https://supabase.com/docs/guides/database/functions).

Proposed API contracts:

| Method | Responsibility |
| --- | --- |
| `listWallets(scope, asOfDate)` | Visible wallets and dated balances |
| `saveWallet(input)` | Create with opening record, or edit metadata |
| `setWalletArchived(input)` | Versioned archive/restore |
| `correctWalletBalance(input)` | Dated adjustment from expected observed balance |
| `listTransactions(filters, cursor)` | Paged, deduplicated transaction history |
| `getTransactionMonthSummary(filters)` | KPIs, category totals, transaction count |
| `saveTransaction(input)` | Validate and save all effects atomically |
| `deleteTransaction(input)` | Remove the whole operation, including both transfer effects |

Every mutation accepts a `request_id`; updates/deletes also accept
`expected_version`. Reuse receipts keyed by household, actor, operation, and
request, with payload hashing. Reject reuse of a request ID with another payload.
Recheck authorization when replaying receipts. Use household serialization as
in existing Finance RPCs; if finer locks are introduced, lock wallet IDs in a
consistent order. Balance corrections additionally verify the displayed balance
or a snapshot token so concurrent transactions cannot produce a wrong adjustment.

Return structured errors for conflict, unavailable wallet, invalid category,
unsupported visibility pairing, and duplicate request. Preserve form values on
failure. After success invalidate affected wallet balances and monthly summaries,
including both old and new months/endpoints on edits. Backdated changes invalidate
subsequent dated balances. Include user ID, household, scope, and filters in query
keys; clear private caches on logout or household change.

## 6. UI and interaction design

### Navigation

Add `Transakcje` next to `Budżet` in Finance:

- `/finance/transactions/overview` — `Przegląd` (default).
- `/finance/transactions/history` — `Historia`.
- `/finance/transactions/wallets` — `Portfele`.
- `/finance/transactions` redirects to overview.

Persist month as `YYYY-MM` and filters in URL parameters. The screen works with
no `finance_months` rows. Do not reuse the current “latest budget month” fallback.
Refactor route-specific loading so this feature does not depend on successful
loading of budget items or savings history.

### Desktop overview

```text
Transakcje                                            [+ Dodaj]
[Przegląd] [Historia] [Portfele]

< Październik 2026 >   [Domowe v]   [Wszystkie portfele v]

[ Przychody ] [ Wydatki bieżące ] [ Bilans miesiąca ] [ Odłożono ]

+--------------------------------+--------------------------------+
| Wydatki według kategorii        | Ostatnie transakcje             |
| [Bieżące / Z oszcz. / Przychody] | Dzisiaj                         |
|                                | Zakupy / Żywność       -180 zł |
| Compact donut + selected value | Pensja               +9 000 zł |
| [Główne / Szczegółowe]          | Przelew A → B         1 000 zł |
| Category / amount / share      | Odłożono · bez wskazania celu   |
|                                | [Zobacz całą historię]          |
+--------------------------------+--------------------------------+

Saldo na dziś: ...       Wydatki z oszczędności: ...
Wydatki łącznie: ...
```

Use existing app typography, surfaces, spacing, and brand colors. Take the
reference image's information hierarchy, not its pink header or oversized chart.
Clicking a category opens history with that filter and preserves month/scope.
Use an accessible category table as the authoritative chart alternative.

### Mobile overview

- Header and month selector, then two-by-two KPI cards.
- Compact chart and category list, then recent transactions.
- Fixed `+` button respects safe areas and does not cover list actions.
- Forms use the app's responsive dialog pattern; keep amount and submit usable
  with the software keyboard open.
- Preserve month and filters across the overview/history navigation.

### History

Group by day; show description/category, wallet, signed display amount, and kind.
Transfers use an arrow and neutral styling rather than appearing as expenses.
Savings-funded expenses show a normal cash debit plus a “Z oszczędności” badge;
their refunds show a credit with the same funding badge. Both are excluded from
regular monthly totals. Contributions show “Odłożono” on the transfer row.
Provide month, wallet, category, and kind filters plus description search.
Show clear active filters and a reset action. Pagination must not reset filters.
Edit opens the same populated form. Delete names the operation and explains both
wallet effects for a transfer. Opening balance editing uses its dedicated action.

### Entry form

Main tabs: `Wydatek`, `Przychód`, `Przelew`; additional action `Odłóż środki`.

- Expense: amount, wallet, category, date, optional description; whole-transaction
  choice “Bieżący” / “Z oszczędności”, default regular. Explain the latter with
  “Zmniejsza saldo portfela, nie pomniejsza bilansu miesiąca”. No partial-savings
  amount input. “Zwrot wydatku” selects `refund` or `savings_refund` according to
  the original funding treatment. Mixed funding uses two separate records.
- Income: amount, destination wallet, income category, date, optional description.
- Transfer: amount, source, destination, date, optional category/description;
  savings effect defaults to none unless selecting a standard saving category.
- Save money: amount, source wallet, saving category, date, and a required different
  destination wallet. This is a shortcut to a contribution transfer. Moving
  existing savings uses an ordinary transfer and is not yet spending them.
- Do not display a nonfunctional goal selector in Release 1. Explain that choosing
  a savings category records monthly saving activity independently of existing goals.
- Default to today and the last accessible active wallet; when adding from a past
  month, require a date in that month rather than silently saving into today.
- Remember wallet preference per user; never silently reuse an inaccessible ID.
- Use decimal input, PLN formatting, explicit field errors, and double-submit
  protection backed by server idempotency.

### Example transaction-entry screens

These wireframes specify the Release 1 form. Example names and balances are
illustrative, not seed data. Explanations are in English; all visible labels
are Polish. Use a centered desktop dialog (approximately 600–640 px wide) and
a full-height mobile dialog with a scrollable body and persistent action footer.

#### Desktop: regular expense

```text
┌──────────────────────────────────────────────────────────────┐
│ Dodaj transakcję                                         [×] │
│                                                              │
│ [ Wydatek ✓ ]       [ Przychód ]       [ Przelew ]             │
│                                                              │
│ Kwota                                                        │
│ [ 180,00                                               PLN ] │
│                                                              │
│ Finansowanie                                                 │
│ [ Bieżące ✓ ]                  [ Z oszczędności ]             │
│                                                              │
│ Z portfela                        Data                        │
│ [ Konto główne               ▾ ]  [ 14.10.2026            ▦ ] │
│ Saldo na dziś: 5 000,00 zł                                    │
│                                                              │
│ Kategoria                                                    │
│ [ Żywność                                                ▾ ] │
│                                                              │
│ Opis (opcjonalnie)                                            │
│ [ Zakupy spożywcze                                          ] │
│                                                              │
│ [ ] To zwrot wydatku                                          │
│                                                              │
│ Wydatki bieżące: +180,00 zł                                   │
│ Wpływ na bilans miesiąca: −180,00 zł                           │
│ Saldo portfela po zapisie: 4 820,00 zł                         │
│                                                              │
│                              [ Anuluj ] [ Dodaj wydatek ]    │
└──────────────────────────────────────────────────────────────┘
```

The amount is visually prominent and receives initial focus on desktop. Wallet
and date share a row on desktop; all fields stack on mobile. Category uses a
searchable selector grouped by main category, restricted to compatible expense
categories. Funding treatment applies to the entire entered amount.

The compact impact preview is explanatory, not a second editable form. It uses
the same kind-based rules as reporting. For a backdated transaction, label the
wallet preview “Saldo na dziś po zapisie” and the monthly effect with the selected
transaction month. Do not imply that today's balance is the historical balance
on the selected date. Hide an unavailable balance preview rather than showing zero.

#### Mobile: expense funded from savings

```text
┌────────────────────────────────────┐
│ Dodaj transakcję                [×]│
│                                    │
│ [Wydatek ✓] [Przychód] [Przelew]    │
│                                    │
│ Kwota                              │
│ [ 2 000,00                   PLN ] │
│                                    │
│ Finansowanie                       │
│ [ Bieżące ] [ Z oszczędności ✓ ]    │
│                                    │
│ Zmniejsza saldo portfela,           │
│ nie pomniejsza bilansu miesiąca.    │
│                                    │
│ Z portfela                         │
│ [ Konto oszczędnościowe         ▾ ] │
│ Saldo na dziś: 8 000,00 zł          │
│                                    │
│ Kategoria                          │
│ [ Dom → Wyposażenie            ▾ ] │
│                                    │
│ Data                               │
│ [ 14.10.2026                   ▦ ] │
│                                    │
│ Opis (opcjonalnie)                 │
│ [ Nowa pralka                    ] │
│                                    │
│ [ ] To zwrot wydatku               │
│                                    │
│ Wydatki z oszczędności: +2 000 zł   │
│ Wpływ na bilans miesiąca: 0 zł      │
│ Saldo po zapisie: 6 000 zł          │
├────────────────────────────────────┤
│ [ Anuluj ] [ Dodaj wydatek ]        │
└────────────────────────────────────┘
```

This saves `kind = 'savings_expense'` and one `amount_minor`. The regular expense
category describes the purchase; it does not cause inclusion in regular monthly
expenses. There is no goal selector and no “savings portion” amount field.
For a PLN 500 purchase funded by PLN 300 of current money and PLN 200 of savings,
the user submits two forms with the appropriate funding choice and wallet.

Checking “To zwrot wydatku” changes the action to “Dodaj zwrot”, the wallet label
to “Do portfela”, and the balance preview to a credit. The funding choice stays
visible and refers to the original purchase. With “Z oszczędności”, this saves
`savings_refund`, reduces net savings spending, and leaves monthly balance
unchanged. With “Bieżące”, it saves `refund` and reduces regular expenses.

#### Desktop: transfer that sets money aside

```text
┌──────────────────────────────────────────────────────────────┐
│ Dodaj transakcję                                         [×] │
│                                                              │
│ [ Wydatek ]         [ Przychód ]       [ Przelew ✓ ]           │
│                                                              │
│ Kwota                                                        │
│ [ 1 000,00                                             PLN ] │
│                                                              │
│ Z portfela                        Do portfela                 │
│ [ Konto główne               ▾ ]  [ Oszczędności          ▾ ] │
│ Saldo: 5 000,00 zł                Saldo: 8 000,00 zł          │
│                                                              │
│ Znaczenie przelewu                                            │
│ ( ) Przenoszę pieniądze                                       │
│ (●) Odkładam nowe oszczędności                                 │
│                                                              │
│ Kategoria                         Data                        │
│ [ Oszczędności               ▾ ]  [ 14.10.2026            ▦ ] │
│                                                              │
│ Opis (opcjonalnie)                                            │
│ [ Odkładanie w październiku                                 ] │
│                                                              │
│ Odłożono w tym miesiącu: +1 000,00 zł                          │
│ Wpływ na bilans miesiąca: 0,00 zł                             │
│ Po zapisie: Konto główne 4 000 zł · Oszczędności 9 000 zł     │
│                                                              │
│                              [ Anuluj ] [ Dodaj przelew ]    │
└──────────────────────────────────────────────────────────────┘
```

“Odłóż środki” opens this tab with the second radio option preselected and
requires a standard saving category. An ordinary transfer defaults to “Przenoszę
pieniądze”; its helper text says “Także przelew już odłożonych oszczędności”.
Its preview shows zero new savings and zero monthly balance effect. Selecting
a saving category can initialize the contribution choice, but must not override
an explicit choice to move existing savings. Exclude the source wallet from the
destination options and apply the same-audience restriction before submission.

#### Income variant

The `Przychód` tab uses the same dialog structure with these fields and preview:

```text
[ Wydatek ] [ Przychód ✓ ] [ Przelew ]

Kwota             [ 9 000,00 PLN       ]
Do portfela       [ Konto główne     ▾ ]
Kategoria         [ Wynagrodzenie   ▾ ]
Data              [ 14.10.2026      ▦ ]
Opis (opcjonalnie)[ Pensja             ]

Przychody: +9 000,00 zł
Wpływ na bilans miesiąca: +9 000,00 zł

                    [ Anuluj ] [ Dodaj przychód ]
```

Income has no funding-treatment control or expense-refund checkbox. Restrict
categories to income. Preserve amount/date/description when switching tabs, but
clear incompatible categories and transaction-specific flags; never carry a
savings-funded expense choice or contribution effect into income accidentally.

#### Validation and save behavior

- Required inputs are amount, date, wallet endpoint(s), and the category required
  by the selected kind. Validate a positive amount and no more than two decimal
  places before submission; keep server validation authoritative.
- Place errors beside fields, for example “Wybierz portfel docelowy” and “Kwota
  musi być większa od zera”. Keep the submit action reachable when errors appear.
- A negative projected wallet balance shows an advisory message but is permitted
  under Release 1's balance rules; do not present it as a hard insufficient-funds error.
- Submit becomes “Zapisuję…” and cannot create a second request while pending.
  On success close the dialog, refresh affected data, and show “Dodano transakcję”.
  On failure keep all input and focus the actionable error.
- Switching between regular and savings funding changes the preview immediately;
  the user must not discover the monthly treatment only after saving.
- For an unsaved edited form, closing by cancel, Escape, or the close button asks
  whether to discard the entered values. Restore focus to the action that opened it.

### Wallet management

Cards/list show name, type, audience, and balance with date. Actions: add, rename,
edit appearance, reconcile balance, history, archive/restore. Creation asks for
name, type, visibility, opening date, and balance. Do not request bank credentials
or account numbers. The list is not limited to wallets with activity this month.

### States and accessibility

Handle no wallets, empty month, no matching results, missing saving categories,
loading, retryable errors, conflict, and offline state. Offer wallet creation
from the initial empty state. Existing category management remains the category
creation entry point. Never show seeded demo money in a real empty household.

Maintain keyboard navigation, dialog focus trapping/restoration, visible labels,
comfortable touch targets, and text/icons alongside color. Charts must not be
the only source of amounts. Offline mutations are unavailable; preserve unsaved
form input and offer retry when connectivity returns.

## 7. Release 2: savings goals and allocations

This is a separate milestone, not a prerequisite for shipping Release 1.
Do not implement a permanent two-way synchronization between legacy savings
transactions and physical-wallet transactions.

### Proposed additional tables

| Table | Purpose and key fields |
| --- | --- |
| `finance_savings_goals` | Common metadata, name, optional target, visibility, owner, archived flag; purpose only, no physical balance |
| `finance_wallet_savings_events` | Wallet, effective date, signed reserved-money delta, event kind, optional source transaction; tracks saved money including amounts not assigned to a goal |
| `finance_goal_allocation_operations` | Versioned header, effective date, operation kind, optional source transaction, description; groups an allocation change atomically |
| `finance_goal_allocation_entries` | Allocation operation, wallet, goal, signed amount; history of assigning/releasing money per wallet-goal pair |
| `private.finance_goal_migration_mappings` | Legacy account ID, mapped goal/wallet IDs, cutover date, reconciliation result; migration provenance, no name-based live synchronization |

All relationships use same-household composite FKs. Apply visibility/owner
compatibility to goals, wallets, and events. Start with shared goals on shared
wallets and private goals on the same owner's private wallets; cross-audience
allocation needs a separate privacy design. Allocation headers and entries must
not reveal hidden goals or wallet IDs.

Derived values per wallet at a given date:

```text
physical balance = sum of physical transaction effects
reserved savings = sum of wallet savings events
assigned to goals = sum of goal allocation entries
unassigned savings = reserved savings - assigned to goals
unallocated cash = physical balance - reserved savings
```

Require nonnegative goal allocations and unassigned savings, and
`0 <= assigned <= reserved <= max(physical balance, 0)`. Negative physical
balances can exist, but cannot support savings allocations. An expense or
correction that would break these constraints must include the required release
of reserved funds/goal allocations or be rejected with an actionable message.
Backdated edits must validate all subsequent affected balance boundaries, not
only today's balance. Lock affected wallets and goals during these checks.

New savings transfers create destination reserved-money events for the full
amount. They may remain unassigned. Assigning
previously reserved money to a goal changes allocation entries only and does not
increase monthly “Odłożono”. Moving savings between wallets moves the reserve
and any chosen goal allocation in one operation without counting a contribution.
Moving money between goals changes allocations only. For each pair of events
generated by a source transaction, use a unique source-and-role key to prevent
duplicate processing. Correct/delete source transactions and dependent events
atomically; block changes invalidating later allocations until reconciled.

A `savings_expense` consumes the source wallet's reserve and selected goal
allocations; a `savings_refund` restores the destination reserve and optionally
goal allocations. Neither changes monthly regular expenses. A preparatory
transfer into the spending wallet moves the reserve there, and the subsequent
payment consumes it once. Goal unassignment leaves money in the unassigned
savings pool; it is neither newly saved money nor spending. Do not introduce
balance-neutral contribution transactions as part of allocation management.

The extended form offers optional goal selection, with a “Split between goals”
expansion. Split totals cannot exceed the contribution; the remainder stays
unassigned. Goals display “Emergency fund → Account A / Account B”, where the
children are derived allocations rather than duplicate wallet definitions.

### Reconcile existing Savings

1. Inventory each legacy node: purpose, physical-account slice, aggregate group,
   investment/retirement record, or unresolved. Do not infer the answer from type
   or account name alone; the current hierarchy mixes these meanings.
2. Explicitly map goals and physical wallets. Multiple legacy nodes can refer to
   the same physical wallet. Preserve meaningful goal grouping in presentation;
   do not turn aggregate nodes into additional balances.
3. Choose a cutover date. Compare known bank/cash balances to legacy goal totals
   and disclose unmatched amounts. Do not fabricate deposits to force equality.
4. Default to opening reserve/allocation events at cutover, with explicit goal
   splits. Keep legacy history read-only before cutover rather than pretending
   it contains complete physical transaction history.
5. Do not regenerate Release 1 monthly contributions from these opening events.
   Release 1 transfers and savings-funded expenses/refunds remain the source of historical activity;
   opening allocations are reconciliation, not new saving.
6. Switch each migrated goal to allocation-derived balances. Disable old balance
   mutations and old plan acceptance for those goals; route future plan acceptance
   through the common transaction/allocation mutation.
7. Keep unmigrated investment/retirement records explicitly separate. Do not sum
   them with wallets when overlap is unresolved. Verify totals and history before
   retiring any legacy write path; do not delete legacy tables in this rollout.

## 8. Frontend structure

Prefer a feature subdirectory instead of expanding the large FinancePage:

```text
frontend/src/finance/transactions/
  TransactionsPage.tsx
  TransactionsOverview.tsx
  TransactionHistory.tsx
  TransactionForm.tsx
  WalletsPanel.tsx
  WalletForm.tsx
  TransactionCategoryChart.tsx
  api.ts
  types.ts
  filters.ts
  calculations.ts
```

Reuse shared exact-money functions. Put authoritative reporting in database
queries; frontend calculations only format or transform returned aggregates.
Avoid implementing two different accounting-rule engines. Reuse React Query
and the current router rather than introducing additional state infrastructure.

## 9. Implementation sequence and acceptance gates

### Milestone 1 — contracts and fixtures

- [x] Confirm this plan's defaults in code contracts: PLN only, date semantics,
  same-audience transfers, explicit savings effects, no automatic legacy linking
  in `frontend/src/finance/transactions/types.ts`.
- [x] Add representative fixtures for two wallets, mixed categories, a refund,
  a contribution transfer, savings-funded spending and its refund, private data,
  and an empty month in `frontend/tests/fixtures/finance-transactions.acceptance.json`.
- [x] Document all transaction-kind constraints and exact expected aggregates
  in Section 3 and the acceptance fixture.

### Milestone 2 — persistence and API

- [ ] Create additive migrations for wallets/transactions, constraints, indexes,
  RLS/grants, mutation contracts, and aggregation reads.
- [ ] Implement atomic wallet creation/opening, transaction CRUD, archive/restore,
  balance reconciliation, idempotency, and optimistic version conflicts.
- [ ] Add database tests and API types/adapters; verify against local Supabase.

### Milestone 3 — usable transaction tracking

- [ ] Integrate routes, scope/month selection, wallets, and entry/edit dialogs.
- [ ] Deliver searchable, filtered, paginated history including paired transfers.
- [ ] Complete empty/error/offline/conflict states and responsive layouts.

### Milestone 4 — monthly overview and Release 1

- [ ] Add KPIs, full-dataset category aggregates, accessible chart/table, and
  recent transactions with drill-down.
- [ ] Verify totals, privacy, mobile entry, and unchanged legacy Savings behavior.
- [ ] Update README and release status with checks actually run.
- [ ] Deploy additive schema before enabling the feature; smoke-test with scoped
  accounts. Feature rollback hides the new UI and preserves newly recorded data.

### Milestone 5 — optional integrations

- [ ] Implement reserve/goal allocation model and migration preview/reconciliation.
- [ ] Migrate explicitly mapped goals and update savings plans/acceptance.
- [ ] Add budget-versus-actual reporting after agreeing which existing budget rows
  are plans; group by month/category without summing plan and actual as expenses.
- [ ] Consider linking project expenses/bill payments through explicit provenance
  to prevent double entry; no automatic matching by name/amount/date.

## 10. Verification matrix

| Area | Required checks |
| --- | --- |
| Core arithmetic | Opening + income - both expense kinds + both refund kinds +/- transfer/correction; exact cents and supported bounds |
| Transfer integrity | Two effects from one record; same wallet rejected; edits/deletes affect both endpoints |
| Savings | Full contribution counted once; savings spending reduces cash but not monthly balance; preparatory transfer does not double-count usage; savings refund restores cash without inflating income/balance/contributions; personal allowance excluded |
| Month/history | Month without budget row; opening-date bounds; year/leap-day boundaries; backdated edits; stable cursor pagination |
| Reporting | Full totals independent of page size; wallet-scoped savings attribution; regular/savings spending separated; net refunds; live category regrouping; incompatible category-section change rejected; parent/child aggregation; archived history |
| Concurrency | Duplicate submission, mismatched idempotency payload, stale versions, concurrent correction and expense, endpoint changes |
| Privacy | Anonymous/outsider denied; shared vs private reads/writes; different private owner denied; mixed-audience transfer rejected; no aggregate/receipt leakage |
| Lifecycle | One opening; signed corrections excluded from income; zero-balance archive; restore before history changes |
| UI | Desktop and narrow phone; keyboard and touch entry; retained input on error; filter persistence; chart alternative; empty/offline states |
| Regression | Existing Budget, Savings, savings plans, Projects, and categories retain current behavior |
| Release 2 | One goal over two wallets; two goals in one wallet; partial assignment; oversubscription; spending reserved funds; backdated constraints; migration totals |

Release 1 acceptance fixture (same shared audience, all in one month): wallet A
opens at PLN 1,000 and B at zero; salary adds PLN 9,000 to A; groceries cost
PLN 180 from A; PLN 1,000 is transferred A → B as new savings; PLN 200 is moved
B → A as existing savings; PLN 200 is then paid from A as a `savings_expense`;
a PLN 20 grocery refund arrives in A, followed by a PLN 50 `savings_refund`.
Expected A = PLN 8,890, B = PLN 800, income = PLN 9,000, net regular expenses =
PLN 160, monthly balance = PLN 8,840, amount set aside = PLN 1,000, and net
savings-funded spending = PLN 150. Combined physical balance is PLN 9,690;
net total spending is PLN 310. The preparatory B → A transfer is not spending.

Additional mixed-funding fixture: pay PLN 300 from A as a regular expense and
PLN 200 from B as a savings expense for one PLN 500 purchase. Physical balances
fall by PLN 500 in total; monthly balance falls by PLN 300; savings-funded
spending rises by PLN 200. There is no partial-funding amount on either record.

Run the relevant frontend suite and build from `../frontend` (`npm test`,
`npm run build`) and database tests from the repository root (`npx supabase test db`)
against the intended local test database after applying the new migrations.
Inspect the CLI's current help and target before migration commands. Verify
database access with authenticated test users, not only a privileged SQL session.
Do not reset a database containing user data as a routine verification step.

No tests or migrations have been run for this document-only change.

## 11. Deferred scope and implementation-time decisions

Deferred: bank connections/import, multi-currency and FX, securities valuation,
credit-card statements, transaction splits across expense categories, recurring
actual transactions, receipt attachments, offline writes, cross-audience
transfers, and automatic legacy synchronization.

Before Release 2, confirm the legacy-node mappings and cutover balances using
actual user data. Before supporting mixed shared/private transfers, decide what
the other household members may see about the private endpoint. Neither question
blocks the Release 1 defaults described above.

This plan is additive to [the existing Finance implementation plan](BUDGET_MIGRATION_IMPLEMENTATION_PLAN.md).
Recheck the [Supabase changelog](https://supabase.com/changelog) and relevant
database documentation before implementation; the Markdown changelog endpoint
was unavailable through the documentation reader during preparation.
