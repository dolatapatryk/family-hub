export const financeNavigation = [
  { id: 'dashboard', label: 'Dashboard', to: '/finance/dashboard' },
  { id: 'dashboard_new', label: 'Dashboard nowy', to: '/finance/dashboard-new' },
  { id: 'budget', label: 'Budżet', to: '/finance/budget' },
  { id: 'transactions', label: 'Transakcje', to: '/finance/transactions/overview' },
  { id: 'categories', label: 'Kategorie transakcji', to: '/finance/categories' },
  { id: 'savings', label: 'Oszczędności', to: '/finance/savings/summary' },
  { id: 'forecast', label: 'Prognozy', to: '/finance/forecast' },
  { id: 'projects', label: 'Projekty', to: '/finance/projects' },
] as const

export const savingsNavigation = [
  { id: 'summary', label: 'Podsumowanie', to: '/finance/savings/summary' },
  { id: 'accounts', label: 'Konta', to: '/finance/savings/accounts' },
  { id: 'planner', label: 'Plan oszczędności', to: '/finance/savings/planner' },
  { id: 'reserves', label: 'Plany i rezerwy', to: '/finance/savings/reserves' },
] as const

export const transactionsNavigation = [
  { id: 'overview', label: 'Przegląd', to: '/finance/transactions/overview' },
  { id: 'history', label: 'Historia', to: '/finance/transactions/history' },
  { id: 'wallets', label: 'Portfele', to: '/finance/transactions/wallets' },
] as const

export type FinanceView = typeof financeNavigation[number]['id']
export type SavingsView = typeof savingsNavigation[number]['id']

export function resolveFinanceRoute(pathname: string): { view: FinanceView; savingsView: SavingsView } | null {
  const path = pathname.replace(/\/$/, '')
  if (path === '/finance' || path === '/finance/dashboard') return { view: 'dashboard', savingsView: 'summary' }
  if (path === '/finance/transactions' || transactionsNavigation.some(item => item.to === path)) return { view: 'transactions', savingsView: 'summary' }
  if (path === '/finance/savings') return { view: 'savings', savingsView: 'summary' }
  const savings = savingsNavigation.find(item => item.to === path)
  if (savings) return { view: 'savings', savingsView: savings.id }
  const page = financeNavigation.find(item => item.to === path)
  return page ? { view: page.id, savingsView: 'summary' } : null
}
