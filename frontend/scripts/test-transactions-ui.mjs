// Run against Vite with configured public Supabase settings. All API requests are mocked.
// PLAYWRIGHT_MODULE may point to a locally available Playwright installation.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TRANSACTIONS_TEST_URL || 'http://127.0.0.1:5176'
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Warsaw', locale: 'pl-PL' })
const page = await context.newPage()
page.setDefaultTimeout(15000)
await page.clock.setFixedTime(new Date('2026-10-15T10:00:00+02:00'))
const errors = []
page.on('pageerror', error => errors.push(error.message))
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'ui-test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const household = '22222222-2222-4222-8222-222222222222'
const row = { household_id: household, created_by: user.id, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1 }
const a = { ...row, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Konto główne', wallet_type: 'bank', visibility: 'household', owner_user_id: user.id, opened_on: '2026-01-01', is_archived: false, currency: 'PLN', color: null, icon: null, as_of_date: '2026-10-15', balance_minor: '889000' }
const b = { ...a, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Oszczędności', balance_minor: '80000' }
const privateWallet = { ...a, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Prywatny', visibility: 'private' }
const food = { ...row, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Żywność', budget_type: 'variable_expense', allocation_role: 'standard', parent_id: null }
const saving = { ...food, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Odkładanie', budget_type: 'saving' }
const transfer = { ...row, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', kind: 'transfer', transaction_date: '2026-10-14', amount_minor: '100000', source_wallet_id: a.id, destination_wallet_id: b.id, category_id: saving.id, description: 'Przelew testowy', savings_effect: 'contribution' }
const expense = { ...transfer, id: '99999999-9999-4999-8999-999999999999', kind: 'expense', transaction_date: '2026-10-12', amount_minor: '18000', destination_wallet_id: null, category_id: food.id, description: 'Zakupy testowe', savings_effect: 'none' }
let wallets = [a, b]
let transactions = [transfer]
let mutationMode = 'success'
let historyFailure = false
const calls = []
await context.addInitScript(({ user, origin }) => {
  const token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 36000 })) + '.mock'
  localStorage.setItem(`sb-${new URL(origin).hostname.split('.')[0]}-auth-token`, JSON.stringify({ access_token: token, refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 36000, expires_in: 36000, token_type: 'bearer', user }))
}, { user, origin: base })
await context.route('**/supabase/**', async route => {
  const url = new URL(route.request().url())
  const args = route.request().postDataJSON() ?? {}
  const endpoint = url.pathname.split('/').at(-1)
  calls.push({ endpoint, args })
  let body = []
  let status = 200
  if (endpoint === 'profiles') body = { id: user.id, household_id: household, name: 'UI test' }
  else if (endpoint === 'user') body = user
  else if (endpoint === 'finance_categories') body = [food, saving, { ...food, id: '77777777-7777-4777-8777-777777777777', name: 'Pensja', budget_type: 'income' }]
  else if (endpoint === 'finance_list_wallets') body = args.p_scope === 'personal' ? [privateWallet] : args.p_scope === 'all_accessible' ? [...wallets, privateWallet] : wallets
  else if (endpoint === 'finance_list_transactions') {
    if (historyFailure) { body = { message: 'Test history failure' }; status = 500 }
    else body = args.p_cursor_id ? { items: [expense], next_cursor: null } : { items: args.p_month_start === '2026-09-01' ? [] : transactions, next_cursor: transactions.length ? { transaction_date: transfer.transaction_date, transaction_id: transfer.id } : null }
  }
  else if (endpoint === 'finance_save_wallet_transaction') {
    if (mutationMode === 'error') { body = { message: 'Test transport failure' }; status = 500 }
    else if (mutationMode === 'conflict') body = { conflict: true, current_version: 2 }
    else body = { transaction_id: expense.id }
  } else if (endpoint === 'finance_preview_wallet_balance') body = { wallet_id: a.id, wallet_version: 1, effective_date: args.p_effective_date, current_balance_minor: '889000', snapshot_token: 'balance-snapshot' }
  else if (endpoint === 'finance_preview_wallet_opening_correction') body = { wallet_id: a.id, wallet_version: 1, opening_transaction_id: 'opening', opening_transaction_version: 1, opened_on: a.opened_on, opening_balance_minor: '100000', snapshot_token: 'opening-snapshot' }
  else if (endpoint === 'finance_correct_wallet_opening') body = { wallet_id: a.id, opening_transaction_id: 'opening', opened_on: args.p_opened_on, opening_balance_minor: args.p_opening_balance_minor, version: 2 }
  else if (endpoint === 'finance_correct_wallet_balance') body = { wallet_id: a.id, transaction_id: 'adjustment', adjustment_minor: '1000', observed_balance_minor: args.p_observed_balance_minor, version: 2 }
  else if (endpoint === 'finance_save_wallet') body = { wallet_id: a.id }
  else if (endpoint === 'finance_delete_wallet_transaction') body = { deleted: true, transaction_id: args.p_transaction_id }
  else if (endpoint === 'finance_set_wallet_archived') {
    wallets = wallets.map(wallet => wallet.id === args.p_wallet_id ? { ...wallet, is_archived: args.p_is_archived, version: wallet.version + 1 } : wallet)
    body = { wallet_id: args.p_wallet_id }
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
})
try {
  await page.goto(`${base}/finance/transactions?month=2026-10`)
  await page.getByText('Przelew testowy', { exact: true }).waitFor()
  assert.match(page.url(), /transactions\/overview/)
  assert.equal(calls.some(call => ['finance_months', 'finance_budget_items', 'finance_savings_accounts'].includes(call.endpoint)), false, 'Transactions do not load legacy budget or savings data')
  await page.getByRole('link', { name: 'Historia', exact: true }).click()
  await page.getByRole('button', { name: 'Pokaż kolejne 50' }).click()
  await page.getByText('Zakupy testowe', { exact: true }).waitFor()
  assert.equal(await page.getByText('Przelew testowy', { exact: true }).count(), 1)
  assert.ok(calls.some(call => call.endpoint === 'finance_list_transactions' && call.args.p_cursor_id === transfer.id))
  await page.getByLabel('Szukaj w opisie', { exact: true }).fill('Przelew')
  await page.getByRole('link', { name: 'Portfele', exact: true }).click()
  assert.match(page.url(), /search=Przelew/)
  await page.getByRole('link', { name: 'Historia', exact: true }).click()
  assert.equal(await page.getByLabel('Szukaj w opisie', { exact: true }).inputValue(), 'Przelew')
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click()

  const add = page.getByRole('button', { name: '+ Dodaj transakcję', exact: true })
  await add.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Kwota (PLN)', { exact: true }).fill('20,55')
  await dialog.getByRole('combobox', { name: 'Kategoria', exact: true }).selectOption(food.id)
  await dialog.getByLabel('Z oszczędności', { exact: true }).check()
  await dialog.getByLabel('To zwrot wydatku').check()
  await dialog.getByLabel('Data', { exact: true }).fill('2026-10-14')
  mutationMode = 'error'
  await dialog.getByRole('button', { name: 'Dodaj zwrot', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await dialog.getByLabel('Kwota (PLN)', { exact: true }).inputValue(), '20,55')
  const failed = calls.filter(call => call.endpoint === 'finance_save_wallet_transaction').at(-1)
  assert.equal(failed.args.p_kind, 'savings_refund'); assert.equal(failed.args.p_amount_minor, '2055')
  mutationMode = 'success'
  await dialog.getByRole('button', { name: 'Dodaj zwrot', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(calls.filter(call => call.endpoint === 'finance_save_wallet_transaction').at(-1).args.p_request_id, failed.args.p_request_id)
  assert.ok(await add.evaluate(node => document.activeElement === node), 'Restore trigger focus')

  await page.getByRole('button', { name: 'Odłóż środki', exact: true }).click()
  await dialog.getByLabel('Kwota (PLN)', { exact: true }).fill('100')
  await dialog.getByRole('combobox', { name: 'Do portfela', exact: true }).selectOption(b.id)
  await dialog.getByRole('combobox', { name: 'Kategoria', exact: true }).selectOption(saving.id)
  await dialog.getByLabel('Przenoszę pieniądze', { exact: true }).check()
  await dialog.getByRole('combobox', { name: 'Kategoria (opcjonalnie)', exact: true }).selectOption(saving.id)
  assert.ok(await dialog.getByLabel('Przenoszę pieniądze', { exact: true }).isChecked())
  await dialog.getByRole('button', { name: 'Dodaj przelew', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(calls.filter(call => call.endpoint === 'finance_save_wallet_transaction').at(-1).args.p_savings_effect, 'none')

  await page.getByRole('button', { name: 'Edytuj', exact: true }).first().click()
  await dialog.getByLabel('Kwota (PLN)', { exact: true }).fill('1100')
  mutationMode = 'conflict'
  await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await dialog.getByLabel('Kwota (PLN)', { exact: true }).inputValue(), '1100')
  assert.ok(await dialog.getByRole('button', { name: 'Zapisz zmiany' }).isDisabled())
  page.once('dialog', confirm => confirm.accept())
  await dialog.getByRole('button', { name: 'Anuluj' }).click()
  mutationMode = 'success'

  historyFailure = true
  await page.reload()
  await page.getByText('Nie udało się wczytać historii.', { exact: false }).waitFor()
  historyFailure = false
  await page.getByRole('button', { name: 'Spróbuj ponownie', exact: true }).click()
  await page.getByText('Przelew testowy', { exact: true }).waitFor()

  await page.setViewportSize({ width: 390, height: 844 })
  await add.click()
  await dialog.getByLabel('Kwota (PLN)', { exact: true }).fill('42')
  await context.setOffline(true)
  await dialog.getByText('Brak połączenia. Formularz zachowuje wpisane dane.').waitFor()
  assert.ok(await dialog.getByRole('button', { name: 'Dodaj wydatek', exact: true }).isDisabled())
  assert.equal(await dialog.getByLabel('Kwota (PLN)', { exact: true }).inputValue(), '42')
  await context.setOffline(false)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await dialog.getByRole('button', { name: 'Dodaj wydatek', exact: true }).scrollIntoViewIfNeeded()
  assert.ok(await dialog.getByRole('button', { name: 'Dodaj wydatek', exact: true }).isVisible())
  await page.screenshot({ path: '/tmp/finance-transactions-mobile.png' })
  page.once('dialog', confirm => confirm.dismiss())
  await page.keyboard.press('Escape')
  assert.ok(await dialog.isVisible(), 'Declining discard keeps the dialog open')
  page.once('dialog', confirm => confirm.accept())
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })

  await page.getByRole('link', { name: 'Portfele', exact: true }).click()
  await page.getByRole('button', { name: 'Uzgodnij saldo' }).first().click()
  await dialog.getByLabel('Rzeczywiste saldo na koniec wybranego dnia (PLN)', { exact: true }).fill('8900')
  await dialog.getByLabel('Powód korekty').fill('Uzgodnienie testowe')
  await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(calls.find(call => call.endpoint === 'finance_correct_wallet_balance').args.p_snapshot_token, 'balance-snapshot')
  await page.getByRole('button', { name: 'Popraw otwarcie' }).first().click()
  await dialog.getByLabel('Saldo początkowe (PLN)', { exact: true }).fill('1200')
  await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(calls.find(call => call.endpoint === 'finance_correct_wallet_opening').args.p_opening_balance_minor, '120000')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: '/tmp/finance-transactions-wallets.png' })

  await page.getByRole('link', { name: 'Historia', exact: true }).click()
  await page.getByRole('button', { name: 'Usuń', exact: true }).first().click()
  await dialog.getByText(/Oba skutki przelewu/).waitFor()
  await dialog.getByRole('button', { name: 'Usuń transakcję', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(calls.find(call => call.endpoint === 'finance_delete_wallet_transaction').args.p_transaction_id, transfer.id)

  await page.getByLabel('Miesiąc', { exact: true }).fill('2026-09')
  await page.getByText('Brak transakcji w tym miesiącu. Dodaj pierwszą transakcję.').waitFor()
  await add.click()
  assert.equal(await dialog.getByLabel('Data', { exact: true }).inputValue(), '')
  await dialog.getByRole('button', { name: 'Anuluj' }).click()
  await page.getByRole('combobox', { name: 'Zakres', exact: true }).selectOption('personal')
  await page.getByRole('combobox', { name: 'Portfel', exact: true }).getByRole('option', { name: 'Prywatny' }).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('combobox', { name: 'Portfel', exact: true }).getByRole('option', { name: 'Konto główne', exact: true }).count(), 0)

  wallets = [a, { ...b, balance_minor: '0' }]
  await page.getByRole('combobox', { name: 'Zakres', exact: true }).selectOption('household')
  await page.getByRole('link', { name: 'Portfele', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Archiwizuj', exact: true }).nth(1).click()
  await dialog.getByRole('button', { name: 'Archiwizuj', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Archiwalne', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Przywróć', exact: true }).click()
  await dialog.getByRole('button', { name: 'Przywróć', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('heading', { name: 'Archiwalne', exact: true }).count(), 0)

  wallets = []; transactions = []
  await page.reload()
  await page.getByRole('combobox', { name: 'Zakres', exact: true }).selectOption('household')
  await page.getByText('Brak portfeli w tym zakresie.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Dodaj portfel', exact: true }).click()
  await dialog.getByLabel('Nazwa', { exact: true }).fill('Nowy portfel')
  await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.ok(calls.some(call => call.endpoint === 'finance_save_wallet' && call.args.p_name === 'Nowy portfel'))
  assert.deepEqual(errors, [])
  console.log('Transaction UI checks passed: routing, pagination, filters, savings refunds, retry identity, explicit transfers, conflict retention, offline/mobile, discard/focus, wallet corrections, delete, past month, scopes and empty wallets.')
} catch (error) {
  await page.screenshot({ path: '/tmp/finance-transactions-failure.png' })
  console.error(await page.getByRole('dialog').ariaSnapshot().catch(() => 'No dialog'))
  throw error
} finally { await browser.close() }
