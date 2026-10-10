import type { FinanceMoney } from './types'

// PostgreSQL numeric(18,2) supports at most 16 whole digits and two decimals.
export const MAX_FINANCE_MINOR_UNITS = 999_999_999_999_999_999n

/** Parse a plain decimal string (or a legacy JSON number) without float math. */
export function parseMoney(value: FinanceMoney | number): bigint {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Amount must be finite.')
  }

  const text = String(value).trim()
  const match = /^([+-]?)(?:(\d+)(?:[.,](\d{1,2}))?|[.,](\d{1,2}))$/.exec(text)
  if (!match) throw new Error('Amount must have at most two decimal places and no grouping separators.')

  const whole = BigInt(match[2] ?? '0')
  const fractional = (match[3] ?? match[4] ?? '').padEnd(2, '0')
  const minorUnits = whole * 100n + BigInt(fractional || '0')
  if (minorUnits > MAX_FINANCE_MINOR_UNITS) throw new Error('Amount exceeds numeric(18,2).')

  return match[1] === '-' ? -minorUnits : minorUnits
}

export function formatMoneyDecimal(minorUnits: bigint): FinanceMoney {
  if (minorUnits > MAX_FINANCE_MINOR_UNITS || minorUnits < -MAX_FINANCE_MINOR_UNITS) {
    throw new Error('Amount exceeds numeric(18,2).')
  }

  const negative = minorUnits < 0n
  const absolute = negative ? -minorUnits : minorUnits
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function addMoney(...values: FinanceMoney[]): FinanceMoney {
  return formatMoneyDecimal(values.reduce((sum, value) => sum + parseMoney(value), 0n))
}

export function subtractMoney(left: FinanceMoney, right: FinanceMoney): FinanceMoney {
  return formatMoneyDecimal(parseMoney(left) - parseMoney(right))
}

export function sumMoney(values: FinanceMoney[]): FinanceMoney {
  return formatMoneyDecimal(values.reduce((sum, value) => sum + parseMoney(value), 0n))
}

/** A bounded precision ratio for display; monetary totals remain exact strings. */
export function moneyRatio(numerator: FinanceMoney, denominator: FinanceMoney): number {
  const denominatorMinor = parseMoney(denominator)
  if (denominatorMinor === 0n) return 0
  const signedNumerator = parseMoney(numerator) * (denominatorMinor < 0n ? -1n : 1n)
  const positiveDenominator = denominatorMinor < 0n ? -denominatorMinor : denominatorMinor
  const negative = signedNumerator < 0n
  const absoluteNumerator = negative ? -signedNumerator : signedNumerator
  const roundedRatio = (absoluteNumerator * 1_000_000n + positiveDenominator / 2n) / positiveDenominator
  return Number(negative ? -roundedRatio : roundedRatio) / 1_000_000
}

export function formatPln(value: FinanceMoney): string {
  const minorUnits = parseMoney(value)
  const negative = minorUnits < 0n
  const absolute = negative ? -minorUnits : minorUnits
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')

  const currency = new Intl.NumberFormat('pl-PL', {
    style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
  const positiveParts = currency.formatToParts(0)
  const negativeParts = currency.formatToParts(-1)
  const selectedParts = negative ? negativeParts : positiveParts
  const integerIndex = selectedParts.findIndex(part => part.type === 'integer')
  const fractionIndex = positiveParts.findIndex(part => part.type === 'fraction')
  const decimal = positiveParts.find(part => part.type === 'decimal')?.value ?? ','
  const prefixParts = selectedParts.slice(0, integerIndex)
  const suffixParts = positiveParts.slice(fractionIndex + 1)
  const groupedWhole = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(whole)

  return `${prefixParts.map(part => part.value).join('')}${groupedWhole}${decimal}${fraction}${suffixParts.map(part => part.value).join('')}`
}
