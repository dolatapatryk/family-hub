import type { FinanceAllocationRole, FinanceBudgetType, FinanceCategory, FinanceSectionId } from './types'

export const financeSections: ReadonlyArray<{
  id: FinanceSectionId
  label: string
  budget_type: FinanceBudgetType
  allocation_role: FinanceAllocationRole
}> = [
  { id: 'income', label: 'Przychody', budget_type: 'income', allocation_role: 'standard' },
  { id: 'personal', label: 'Na indywidualne konta', budget_type: 'saving', allocation_role: 'personal_allowance' },
  { id: 'fixed_expense', label: 'Wydatki stałe', budget_type: 'fixed_expense', allocation_role: 'standard' },
  { id: 'variable_expense', label: 'Wydatki zmienne', budget_type: 'variable_expense', allocation_role: 'standard' },
  { id: 'saving', label: 'Odkładanie na początku miesiąca', budget_type: 'saving', allocation_role: 'standard' },
  { id: 'investment', label: 'Inwestycje', budget_type: 'investment', allocation_role: 'standard' },
]

export function categorySection(category: Pick<FinanceCategory, 'budget_type' | 'allocation_role'>): FinanceSectionId {
  return category.budget_type === 'saving' && category.allocation_role === 'personal_allowance' ? 'personal' : category.budget_type
}

/** Legacy names equal to their category are redundant descriptions. */
export function budgetItemDescription(name: string, category: Pick<FinanceCategory, 'name'> | undefined): string {
  const description = name.trim()
  return category && description.toLocaleLowerCase('pl-PL') === category.name.trim().toLocaleLowerCase('pl-PL') ? '' : description
}

export function budgetItemTitle(name: string, category: Pick<FinanceCategory, 'name'> | undefined): string {
  const description = budgetItemDescription(name, category)
  if (!category) return description || 'Kategoria niedostępna'
  return description ? `${category.name} — ${description}` : category.name
}
