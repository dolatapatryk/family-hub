export interface Bill {
  id: string
  title: string
  dueDay: number
  intervalMonths: 1 | 2
  nextDueOn: string
  /** Integer hundredths of the bill currency. */
  expectedAmountMinor: number | null
  currency: string
  active: boolean
  createdAt: string
}

export type BillHistoryEntry = {
  id: string
  dueOn: string
  kind: 'paid'
  paidOn: string
  /** Integer hundredths of the payment currency. */
  amountMinor: number
  currency: string
  recordedAt: string
} | {
  id: string
  dueOn: string
  kind: 'skipped'
  skippedAt: string
}

export function localDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatBillDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day))
}

export function formatBillTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(timestamp))
}

export function formatBillAmount(amountMinor: number, currency: string) {
  const whole = Math.trunc(amountMinor / 100)
  const fractional = String(amountMinor % 100).padStart(2, '0')
  const formattedWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(whole)
  return `${formattedWhole}.${fractional} ${currency}`
}

export function amountInputToMinorUnits(value: string): number | null {
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(value.trim())
  if (!match || (match[1] === '' && match[2] === undefined)) return null
  const whole = Number(match[1] || '0')
  const fractional = Number((match[2] ?? '').padEnd(2, '0') || '0')
  const amount = whole * 100 + fractional
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function minorUnitsToAmountInput(amount: number) {
  return (amount / 100).toFixed(2)
}

export function isBillDueThisMonthOrOverdue(nextDueOn: string, today = localDate()) {
  return nextDueOn < today || nextDueOn.slice(0, 7) === today.slice(0, 7)
}
