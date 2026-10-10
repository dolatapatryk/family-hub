import type { FinanceSavingsAccount, FinanceViewer } from './types'

/**
 * These helpers shape client-side presentation only. Postgres RLS and finance
 * mutation functions remain the authorization boundary for every read/write.
 */
export function isSavingsAccountInViewerAudience(
  account: Pick<FinanceSavingsAccount, 'household_id' | 'visibility' | 'owner_user_id'>,
  viewer: FinanceViewer,
): boolean {
  if (account.household_id !== viewer.household_id) return false
  return account.visibility === 'household' || account.owner_user_id === viewer.user_id
}

export function canTransferBetweenSavingsAccounts(
  from: Pick<FinanceSavingsAccount, 'household_id' | 'visibility' | 'owner_user_id'>,
  to: Pick<FinanceSavingsAccount, 'household_id' | 'visibility' | 'owner_user_id'>,
): boolean {
  if (from.household_id !== to.household_id) return false
  if (from.visibility === 'household' && to.visibility === 'household') return true
  return from.visibility === 'private' && to.visibility === 'private' && from.owner_user_id === to.owner_user_id
}

export function canNestSavingsAccount(
  parent: Pick<FinanceSavingsAccount, 'visibility' | 'owner_user_id'>,
  child: Pick<FinanceSavingsAccount, 'visibility' | 'owner_user_id'>,
): boolean {
  if (parent.visibility !== child.visibility) return false
  return parent.owner_user_id === child.owner_user_id
}
