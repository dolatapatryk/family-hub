import { test } from 'node:test'
import assert from 'node:assert/strict'
import { financeNavigation, savingsNavigation, resolveFinanceRoute } from '../src/finance/navigation.ts'

test('Finanse opens Dashboard and every sidebar destination resolves to its own page', () => {
  assert.equal(resolveFinanceRoute('/finance').view, 'dashboard')
  assert.equal(resolveFinanceRoute('/finance/').view, 'dashboard')
  assert.deepEqual(financeNavigation.map(item => item.label), ['Dashboard', 'Budżet', 'Kategorie transakcji', 'Oszczędności', 'Prognozy', 'Projekty'])
  for (const item of financeNavigation) {
    assert.equal(resolveFinanceRoute(item.to).view, item.id)
    assert.equal(resolveFinanceRoute(`${item.to}/`).view, item.id)
  }
})

test('savings deep links preserve the four original sections and select the savings sidebar entry', () => {
  assert.deepEqual(savingsNavigation.map(item => item.label), ['Podsumowanie', 'Konta', 'Plan oszczędności', 'Plany i rezerwy'])
  assert.deepEqual(resolveFinanceRoute('/finance/savings'), { view: 'savings', savingsView: 'summary' })
  for (const item of savingsNavigation) assert.deepEqual(resolveFinanceRoute(item.to), { view: 'savings', savingsView: item.id })
  assert.equal(resolveFinanceRoute('/finance/savings/unknown'), null)
  assert.equal(resolveFinanceRoute('/finance-budget'), null)
  assert.equal(resolveFinanceRoute('/tasks'), null)
})
