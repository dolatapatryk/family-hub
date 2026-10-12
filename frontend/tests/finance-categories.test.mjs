import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budgetItemDescription, budgetItemTitle, categorySection, financeSections } from '../src/finance/categories.ts'
import { calculateMonthSummary } from '../src/finance/calculations.ts'

test('all six sections have distinct category classifications including individual accounts', () => {
  assert.equal(financeSections.length, 6)
  assert.equal(new Set(financeSections.map(categorySection)).size, 6)
  for (const section of financeSections) assert.equal(categorySection(section), section.id)
  assert.equal(categorySection({ budget_type: 'saving', allocation_role: 'standard' }), 'saving')
  assert.equal(categorySection({ budget_type: 'saving', allocation_role: 'personal_allowance' }), 'personal')
})

test('category labels replace redundant legacy names while preserving specific descriptions', () => {
  const category = { name: 'Zakupy' }
  assert.equal(budgetItemTitle('', category), 'Zakupy')
  assert.equal(budgetItemTitle('  ZAKUPY  ', category), 'Zakupy')
  assert.equal(budgetItemDescription('Zakupy', category), '')
  assert.equal(budgetItemTitle('  Spożywcze  ', category), 'Zakupy — Spożywcze')
  assert.equal(budgetItemDescription('  Spożywcze  ', category), 'Spożywcze')
  assert.equal(budgetItemTitle('', { name: 'Jedzenie' }), 'Jedzenie')
  assert.equal(budgetItemTitle('Historyczna pozycja', undefined), 'Historyczna pozycja')
})

test('individual-account categories reduce the shared budget without increasing expenses or savings', () => {
  const line = (sectionId, amount) => {
    const section = financeSections.find(section => section.id === sectionId)
    return { id: sectionId, name: section.label, amount, budget_type: section.budget_type,
      allocation_role: section.allocation_role, is_planned: false, is_recurring: false }
  }
  const summary = calculateMonthSummary([
    line('income', '10000.00'), line('personal', '1000.00'), line('fixed_expense', '2000.00'),
    line('variable_expense', '1500.00'), line('saving', '2000.00'), line('investment', '500.00'),
  ])
  assert.equal(summary.personal_allowances, '1000.00')
  assert.equal(summary.income_after_personal_allowances, '9000.00')
  assert.equal(summary.total_expenses, '3500.00')
  assert.equal(summary.savings_and_investments, '2500.00')
  assert.equal(summary.cashflow, '3000.00')
})
