import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculateActiveSavingsTreeBalance,
  calculateSavingsAccountTreeBalance,
  isSavingsAccountArchived,
  getActiveSavingsAccounts,
} from './calculations'
import { FinanceVersionConflictError, createFinanceApi } from './api'
import { FinanceSummariesPanel } from './FinanceSummariesPanel'
import { FinanceKpis } from './FinanceCharts'
import { SavingsTransfersPanel } from './SavingsTransfersPanel'
import { SavingsAccountLifecycle } from './SavingsAccountLifecycle'
import { useMobileDialogSwipeDismiss } from '../components/useMobileDialogSwipeDismiss'
import { financeMinorUnitsToMoney, formatPln, moneyToFinanceMinorUnits, moneyRatio, sumMoney, addMoney } from './money'
import { createUuid } from '../utils/uuid'
import type {
  FinanceSavingsAccount,
  FinanceSavingsAccountType,
  FinanceMonth,
  FinanceSavingsPlan,
  FinanceSavingsTransaction,
  FinanceVisibility,
} from './types'

type TransactionDirection = 'deposit' | 'withdrawal'

const accountTypeNames: Record<FinanceSavingsAccountType, string> = {
  cash: 'Gotówka',
  goal: 'Cel',
  investment: 'Inwestycje',
  retirement: 'Emerytura',
}

function localDateToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function privacyLabel(visibility: FinanceVisibility) {
  return visibility === 'household' ? 'Domowe' : 'Prywatne'
}

function accountPathLabel(account: FinanceSavingsAccount, accounts: FinanceSavingsAccount[]) {
  const path = [account.name]
  const visited = new Set([account.id])
  let parentId = account.parent_id
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = accounts.find(candidate => candidate.id === parentId)
    if (!parent) break
    path.unshift(parent.name)
    parentId = parent.parent_id
  }
  return path.join(' / ')
}

function monthLabel(month: FinanceMonth) {
  if (month.display_name) return month.display_name
  return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(`${month.month_start}T12:00:00`))
}

function errorText(error: unknown) {
  if (error instanceof FinanceVersionConflictError) {
    return error.current_version === null
      ? 'To konto lub operacja nie jest już dostępna.'
      : 'Dane zmieniły się po ich załadowaniu. Odświeżono dostępne informacje — sprawdź je i spróbuj ponownie.'
  }
  return error instanceof Error ? error.message : 'Nie udało się zapisać zmian.'
}

function absMoney(minorUnits: string) {
  const value = BigInt(minorUnits)
  return financeMinorUnitsToMoney((value < 0n ? -value : value).toString())
}

interface MonthlySavingsPlanItem {
  id: string
  account_id: string
  amount_minor: string
  description: string | null
  template_id: string | null
}

interface MonthlySavingsPlanState {
  storage_key: string
  items: MonthlySavingsPlanItem[]
}

function readMonthlyPlan(storageKey: string): MonthlySavingsPlanItem[] {
  if (!storageKey) return []
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is MonthlySavingsPlanItem => typeof item === 'object' && item !== null
      && typeof item.id === 'string' && typeof item.account_id === 'string'
      && typeof item.amount_minor === 'string' && (item.description === null || typeof item.description === 'string')
      && (item.template_id === null || typeof item.template_id === 'string'))
  } catch {
    return []
  }
}

function polishCount(count: number, singular: string, few: string, many: string) {
  const lastTwo = count % 100
  const last = count % 10
  if (count === 1) return `${count} ${singular}`
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} ${few}`
  return `${count} ${many}`
}

function MonthlySavingsPlanItemEditor({ item, accounts, pending, onSave, onRemove }: {
  item: MonthlySavingsPlanItem
  accounts: FinanceSavingsAccount[]
  pending: boolean
  onSave: (changes: Pick<MonthlySavingsPlanItem, 'account_id' | 'amount_minor' | 'description'>) => void
  onRemove: () => void
}) {
  const [accountId, setAccountId] = useState(item.account_id)
  const [amount, setAmount] = useState(financeMinorUnitsToMoney(item.amount_minor))
  const [description, setDescription] = useState(item.description ?? '')
  const [error, setError] = useState('')
  return <form className="finance-savings-plan-item-edit" onSubmit={event => {
    event.preventDefault()
    try {
      const amountMinor = moneyToFinanceMinorUnits(amount)
      if (BigInt(amountMinor) === 0n) throw new Error('Kwota musi być różna od zera.')
      setError('')
      onSave({ account_id: accountId, amount_minor: amountMinor, description: description.trim() || null })
    } catch (saveError) {
      setError(errorText(saveError))
    }
  }}>
    <label>Konto<select required value={accountId} onChange={event => setAccountId(event.target.value)} disabled={pending}>
      {accounts.map(account => <option value={account.id} key={account.id}>{accountPathLabel(account, accounts)} · {privacyLabel(account.visibility)}</option>)}
    </select></label>
    <label>Kwota<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={pending} /></label>
    <label>Opis<input maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} disabled={pending} /></label>
    {error && <p className="error-message finance-error" role="alert">{error}</p>}
    <div className="finance-edit-actions">
      <button className="primary-button" type="submit" disabled={pending || !accounts.some(account => account.id === accountId)}>Zapisz plan</button>
      <button className="button-quiet" type="button" onClick={onRemove} disabled={pending}>Usuń</button>
    </div>
  </form>
}

export function SavingsAccountsPanel({
  api,
  householdId,
  userId,
  months,
  selectedMonthId,
  onSelectMonth,
  mode,
}: {
  mode: 'summary' | 'accounts' | 'planner'
  api: ReturnType<typeof createFinanceApi>
  householdId: string
  userId: string
  months: FinanceMonth[]
  selectedMonthId: string
  onSelectMonth: (monthId: string) => void
}) {
  const queryClient = useQueryClient()
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState<FinanceSavingsAccountType>('cash')
  const [openingBalance, setOpeningBalance] = useState('0.00')
  const [targetAmount, setTargetAmount] = useState('')
  const [visibility, setVisibility] = useState<FinanceVisibility>('private')
  const [parentAccountId, setParentAccountId] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [expandedSummaryAccountId, setExpandedSummaryAccountId] = useState('')
  const [planAccountId, setPlanAccountId] = useState('')
  const [transactionDirection, setTransactionDirection] = useState<TransactionDirection>('deposit')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [transactionDate, setTransactionDate] = useState(localDateToday)
  const [transactionDescription, setTransactionDescription] = useState('')
  const [excludeFromSavings, setExcludeFromSavings] = useState(false)
  const [transactionFormError, setTransactionFormError] = useState('')
  const [transactionToggleError, setTransactionToggleError] = useState('')
  const [editingTransactionId, setEditingTransactionId] = useState('')
  const [editTransactionDirection, setEditTransactionDirection] = useState<TransactionDirection>('deposit')
  const [editTransactionAmount, setEditTransactionAmount] = useState('')
  const [editTransactionDate, setEditTransactionDate] = useState('')
  const [editTransactionDescription, setEditTransactionDescription] = useState('')
  const [editExcludeFromSavings, setEditExcludeFromSavings] = useState(false)
  const [transactionEditFormError, setTransactionEditFormError] = useState('')
  const [planAmount, setPlanAmount] = useState('')
  const [planDescription, setPlanDescription] = useState('')
  const [planError, setPlanError] = useState('')
  const [acceptanceError, setAcceptanceError] = useState('')
  const [acceptedCount, setAcceptedCount] = useState(0)
  const activeMonthForPlan = months.find(month => month.id === selectedMonthId)
  const monthlyPlanStorageKey = activeMonthForPlan
    ? `family-hub:finance:monthlySavingsPlan:${householdId}:${userId}:${activeMonthForPlan.month_start}`
    : ''
  const [monthlyPlanState, setMonthlyPlanState] = useState<MonthlySavingsPlanState>(() => ({
    storage_key: monthlyPlanStorageKey,
    items: readMonthlyPlan(monthlyPlanStorageKey),
  }))
  const transactionDialogRef = useRef<HTMLDialogElement>(null)
  const accountRequests = useRef(new Map<string, string>())
  const transactionRequests = useRef(new Map<string, string>())
  const deleteRequests = useRef(new Map<string, string>())

  const accountsKey = ['financeSavingsAccounts', householdId, userId] as const
  const transactionsKey = ['financeSavingsTransactions', householdId, userId] as const
  const accounts = useQuery({ queryKey: accountsKey, queryFn: ({ signal }) => api.listSavingsAccounts(signal) })
  const transactions = useQuery({ queryKey: transactionsKey, queryFn: ({ signal }) => api.listSavingsTransactions(signal) })
  const templates = useQuery({
    queryKey: ['financeSavingsPlans', householdId, userId],
    queryFn: ({ signal }) => api.listSavingsPlans(signal),
    enabled: mode === 'planner',
  })
  const accountList = accounts.data ?? []
  const activeAccounts = useMemo(() => getActiveSavingsAccounts(accountList), [accountList])
  const expandedSummaryAccountIds = useMemo(() => {
    const expandedIds = new Set<string>()
    let account = activeAccounts.find(candidate => candidate.id === expandedSummaryAccountId)
    while (account && !expandedIds.has(account.id)) {
      expandedIds.add(account.id)
      account = account.parent_id
        ? activeAccounts.find(candidate => candidate.id === account?.parent_id)
        : undefined
    }
    return expandedIds
  }, [activeAccounts, expandedSummaryAccountId])
  const transactionList = transactions.data ?? []
  const templateList = templates.data ?? []
  const monthlyPlanItems = monthlyPlanState.storage_key === monthlyPlanStorageKey ? monthlyPlanState.items : []
  const selectedAccount = accountList.find(account => account.id === selectedAccountId)
  const selectedAccountActive = activeAccounts.some(account => account.id === selectedAccountId)
  const selectedTransactions = transactionList.filter(transaction => transaction.account_id === selectedAccountId)
  const editingTransaction = transactionList.find(transaction => transaction.id === editingTransactionId)

  useEffect(() => {
    const dialog = transactionDialogRef.current
    if (!dialog) return
    if (editingTransactionId && !dialog.open) dialog.showModal()
    else if (!editingTransactionId && dialog.open) dialog.close()
  }, [editingTransaction, editingTransactionId])

  useEffect(() => {
    const availableAccounts = mode === 'summary' ? activeAccounts : accountList
    if (!availableAccounts.some(account => account.id === selectedAccountId)) {
      setSelectedAccountId(availableAccounts[0]?.id ?? '')
    }
  }, [accountList, activeAccounts, selectedAccountId, mode])

  useEffect(() => {
    if (expandedSummaryAccountId && !activeAccounts.some(account => account.id === expandedSummaryAccountId)) {
      setExpandedSummaryAccountId('')
    }
  }, [activeAccounts, expandedSummaryAccountId])

  useEffect(() => {
    if (!activeAccounts.some(account => account.id === planAccountId)) {
      setPlanAccountId(activeAccounts[0]?.id ?? '')
    }
  }, [activeAccounts, planAccountId])

  useEffect(() => {
    setMonthlyPlanState({ storage_key: monthlyPlanStorageKey, items: readMonthlyPlan(monthlyPlanStorageKey) })
    setAcceptedCount(0)
    setAcceptanceError('')
  }, [monthlyPlanStorageKey])

  useEffect(() => {
    if (!monthlyPlanStorageKey || monthlyPlanState.storage_key !== monthlyPlanStorageKey) return
    try {
      window.localStorage.setItem(monthlyPlanStorageKey, JSON.stringify(monthlyPlanState.items))
    } catch {
      // Keep the current plan editable for this session when browser storage is unavailable.
    }
  }, [monthlyPlanState, monthlyPlanStorageKey])

  function persistMonthlyPlan(items: MonthlySavingsPlanItem[]) {
    if (!monthlyPlanStorageKey) return
    const state = { storage_key: monthlyPlanStorageKey, items }
    setMonthlyPlanState(state)
    try {
      window.localStorage.setItem(monthlyPlanStorageKey, JSON.stringify(items))
    } catch {
      // Keep the current plan editable for this session when browser storage is unavailable.
    }
  }

  function invalidateSavings() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: accountsKey }),
      queryClient.invalidateQueries({ queryKey: transactionsKey }),
    ])
  }

  const saveAccount = useMutation({
    mutationFn: async (input: {
      signature: string
      account_id?: string
      expected_version?: number
      name: string
      account_type: FinanceSavingsAccountType
      opening_balance?: string | null
      target_amount: string | null
      visibility: FinanceVisibility
      parent_id?: string | null
    }) => {
      let requestId = accountRequests.current.get(input.signature)
      if (!requestId) {
        requestId = createUuid()
        accountRequests.current.set(input.signature, requestId)
      }
      await api.saveSavingsAccount({
        request_id: requestId,
        account_id: input.account_id ?? null,
        expected_version: input.expected_version ?? null,
        name: input.name,
        account_type: input.account_type,
        parent_id: input.account_id
          ? accountList.find(account => account.id === input.account_id)?.parent_id ?? null
          : input.parent_id ?? null,
        opening_balance: input.opening_balance ?? null,
        target_amount: input.target_amount,
        visibility: input.visibility,
      })
      return input.signature
    },
    onSuccess: async (signature, input) => {
      accountRequests.current.delete(signature)
      if (!input.account_id) {
        setAccountName('')
        setOpeningBalance('0.00')
        setTargetAmount('')
        setParentAccountId('')
      }
      await invalidateSavings()
    },
    onError: async (error, input) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      accountRequests.current.delete(input.signature)
      await invalidateSavings()
    },
  })

  const saveTransaction = useMutation({
    mutationFn: async (input: {
      signature: string
      transaction_id?: string
      expected_version?: number
      account_id: string
      amount: string
      transaction_date: string
      description: string
      excluded_from_monthly_savings: boolean
      monthly_savings_toggle?: boolean
    }) => {
      let requestId = transactionRequests.current.get(input.signature)
      if (!requestId) {
        requestId = createUuid()
        transactionRequests.current.set(input.signature, requestId)
      }
      await api.saveSavingsTransaction({
        request_id: requestId,
        transaction_id: input.transaction_id ?? null,
        expected_version: input.expected_version ?? null,
        account_id: input.account_id,
        transaction_date: input.transaction_date,
        amount: input.amount,
        description: input.description.trim() || null,
        excluded_from_monthly_savings: input.excluded_from_monthly_savings,
      })
      return input.signature
    },
    onSuccess: async (signature, input) => {
      transactionRequests.current.delete(signature)
      setTransactionToggleError('')
      if (!input.transaction_id) {
        setTransactionAmount('')
        setTransactionDescription('')
        setExcludeFromSavings(false)
      }
      setEditingTransactionId('')
      await invalidateSavings()
    },
    onError: async (error, input) => {
      if (input.monthly_savings_toggle) setTransactionToggleError(errorText(error))
      if (!(error instanceof FinanceVersionConflictError)) return
      transactionRequests.current.delete(input.signature)
      setEditingTransactionId('')
      await invalidateSavings()
    },
  })

  const deleteTransaction = useMutation({
    mutationFn: async (transaction: FinanceSavingsTransaction) => {
      const signature = `${transaction.id}:${transaction.version}`
      let requestId = deleteRequests.current.get(signature)
      if (!requestId) {
        requestId = createUuid()
        deleteRequests.current.set(signature, requestId)
      }
      await api.deleteSavingsTransaction({
        request_id: requestId,
        transaction_id: transaction.id,
        expected_version: transaction.version,
      })
      return signature
    },
    onSuccess: async signature => {
      deleteRequests.current.delete(signature)
      await invalidateSavings()
    },
    onError: async error => {
      if (error instanceof FinanceVersionConflictError) await invalidateSavings()
    },
  })

  const acceptMonthlyPlan = useMutation({
    mutationFn: async (monthId: string) => {
      const month = months.find(candidate => candidate.id === monthId)
      if (!month) throw new Error('Wybierz dostępny miesiąc.')
      let remaining = monthlyPlanItems
      let posted = 0
      for (const item of monthlyPlanItems) {
        const account = accountList.find(candidate => candidate.id === item.account_id)
        if (!account || isSavingsAccountArchived(account, accountList)) {
          throw new Error(`Konto „${account?.name ?? 'niedostępne'}” nie jest aktywne. Zmień konto w planie.`)
        }
        await api.saveSavingsTransaction({
          request_id: item.id,
          account_id: item.account_id,
          transaction_date: month.month_start,
          amount: financeMinorUnitsToMoney(item.amount_minor),
          description: item.description,
          excluded_from_monthly_savings: false,
        })
        remaining = remaining.filter(candidate => candidate.id !== item.id)
        persistMonthlyPlan(remaining)
        posted += 1
        setAcceptedCount(posted)
      }
      return posted
    },
    onSuccess: async posted => {
      setAcceptedCount(posted)
      setAcceptanceError('')
      await invalidateSavings()
    },
    onError: async error => {
      setAcceptanceError(errorText(error))
      await invalidateSavings()
    },
  })

  function selectMonth(monthId: string) {
    onSelectMonth(monthId)
    setAcceptedCount(0)
    setAcceptanceError('')
  }

  function submitMonthlyPlanItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedMonthId || !activeAccounts.some(account => account.id === planAccountId)) {
      setPlanError('Wybierz aktywne konto i miesiąc.')
      return
    }
    let amountMinor: string
    try {
      amountMinor = moneyToFinanceMinorUnits(planAmount)
      if (BigInt(amountMinor) === 0n) throw new Error('Kwota musi być różna od zera.')
      setPlanError('')
    } catch (error) {
      setPlanError(errorText(error))
      return
    }
    persistMonthlyPlan([...monthlyPlanItems, {
      id: createUuid(),
      account_id: planAccountId,
      amount_minor: amountMinor,
      description: planDescription.trim() || null,
      template_id: null,
    }])
    setPlanAmount('')
    setPlanDescription('')
  }

  function addTemplateToMonthlyPlan(plan: FinanceSavingsPlan) {
    if (!plan.account_id || BigInt(plan.monthly_amount) <= 0n
      || monthlyPlanItems.some(item => item.template_id === plan.id)) return
    const account = accountList.find(candidate => candidate.id === plan.account_id)
    if (!account || isSavingsAccountArchived(account, accountList)) return
    persistMonthlyPlan([...monthlyPlanItems, {
      id: createUuid(),
      account_id: account.id,
      amount_minor: plan.monthly_amount,
      description: plan.name,
      template_id: plan.id,
    }])
  }

  function updateMonthlyPlanItem(itemId: string, changes: Partial<Pick<MonthlySavingsPlanItem, 'account_id' | 'amount_minor' | 'description'>>) {
    persistMonthlyPlan(monthlyPlanItems.map(item => item.id === itemId ? { ...item, ...changes } : item))
  }

  function removeMonthlyPlanItem(itemId: string) {
    persistMonthlyPlan(monthlyPlanItems.filter(item => item.id !== itemId))
  }

  function acceptPlan() {
    setAcceptedCount(0)
    setAcceptanceError('')
    acceptMonthlyPlan.mutate(selectedMonthId)
  }

  function submitNewAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const inheritedVisibility = accountList.find(account => account.id === parentAccountId)?.visibility ?? visibility
    const signature = JSON.stringify({ name: accountName.trim(), accountType, openingBalance, targetAmount, visibility: inheritedVisibility, parentAccountId })
    saveAccount.mutate({
      signature,
      name: accountName.trim(),
      account_type: accountType,
      opening_balance: openingBalance,
      target_amount: targetAmount.trim() || null,
      visibility: inheritedVisibility,
      parent_id: parentAccountId || null,
    })
  }

  async function saveEditedAccount(account: FinanceSavingsAccount, input: {
    expected_version: number
    name: string
    account_type: FinanceSavingsAccountType
    target_amount: string | null
    visibility: FinanceVisibility
  }) {
    const signature = JSON.stringify({ id: account.id, ...input })
    await saveAccount.mutateAsync({
      signature,
      account_id: account.id,
      expected_version: input.expected_version,
      name: input.name,
      account_type: input.account_type,
      target_amount: input.target_amount,
      visibility: input.visibility,
    })
  }

  function signedAmount(amount: string, direction: TransactionDirection) {
    const minor = BigInt(moneyToFinanceMinorUnits(amount))
    if (minor <= 0n) throw new Error('Kwota musi być większa od zera.')
    return financeMinorUnitsToMoney((direction === 'withdrawal' ? -minor : minor).toString())
  }

  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedAccount) return
    setTransactionToggleError('')
    let signed: string
    try {
      signed = signedAmount(transactionAmount, transactionDirection)
      setTransactionFormError('')
    } catch (error) {
      setTransactionFormError(errorText(error))
      return
    }
    const signature = JSON.stringify({ account_id: selectedAccount.id, amount: signed, transactionDate, transactionDescription: transactionDescription.trim(), excludeFromSavings })
    saveTransaction.mutate({
      signature,
      account_id: selectedAccount.id,
      amount: signed,
      transaction_date: transactionDate,
      description: transactionDescription,
      excluded_from_monthly_savings: excludeFromSavings,
    })
  }

  function startTransactionEdit(transaction: FinanceSavingsTransaction) {
    const amount = BigInt(transaction.amount)
    saveTransaction.reset()
    setTransactionToggleError('')
    setEditingTransactionId(transaction.id)
    setTransactionEditFormError('')
    setEditTransactionDirection(amount < 0n ? 'withdrawal' : 'deposit')
    setEditTransactionAmount(absMoney(transaction.amount))
    setEditTransactionDate(transaction.transaction_date)
    setEditTransactionDescription(transaction.description ?? '')
    setEditExcludeFromSavings(transaction.excluded_from_monthly_savings)
  }

  function closeTransactionEdit() {
    setEditingTransactionId('')
    setTransactionEditFormError('')
  }

  const swipeTransactionDialogRef = useMobileDialogSwipeDismiss(transactionDialogRef, closeTransactionEdit, !saveTransaction.isPending)

  function submitTransactionEdit(event: FormEvent<HTMLFormElement>, transaction: FinanceSavingsTransaction) {
    event.preventDefault()
    setTransactionToggleError('')
    let signed: string
    try {
      signed = signedAmount(editTransactionAmount, editTransactionDirection)
      setTransactionEditFormError('')
    } catch (error) {
      setTransactionEditFormError(errorText(error))
      return
    }
    const signature = JSON.stringify({ id: transaction.id, version: transaction.version, accountId: transaction.account_id, signed, editTransactionDate, editTransactionDescription: editTransactionDescription.trim(), editExcludeFromSavings })
    saveTransaction.mutate({
      signature,
      transaction_id: transaction.id,
      expected_version: transaction.version,
      account_id: transaction.account_id,
      amount: signed,
      transaction_date: editTransactionDate,
      description: editTransactionDescription,
      excluded_from_monthly_savings: editExcludeFromSavings,
    })
  }

  function setTransactionMonthlySavingsStatus(transaction: FinanceSavingsTransaction, included: boolean) {
    if (transaction.transfer_id || BigInt(transaction.amount) <= 0n) return
    setTransactionToggleError('')
    const signature = JSON.stringify({
      transaction_id: transaction.id,
      expected_version: transaction.version,
      excluded_from_monthly_savings: !included,
    })
    saveTransaction.mutate({
      signature,
      transaction_id: transaction.id,
      expected_version: transaction.version,
      account_id: transaction.account_id,
      amount: financeMinorUnitsToMoney(transaction.amount),
      transaction_date: transaction.transaction_date,
      description: transaction.description ?? '',
      excluded_from_monthly_savings: !included,
      monthly_savings_toggle: true,
    })
  }

  const balanceAccounts = accountList.map(account => ({
    id: account.id,
    opening_balance: financeMinorUnitsToMoney(account.opening_balance),
    parent_id: account.parent_id,
    is_archived: account.is_archived,
  }))
  const balanceAccountsById = new Map(balanceAccounts.map(account => [account.id, account] as const))
  const balanceTransactions = transactionList.map(transaction => ({
    account_id: transaction.account_id,
    amount: financeMinorUnitsToMoney(transaction.amount),
    transaction_date: transaction.transaction_date,
    excluded_from_monthly_savings: transaction.excluded_from_monthly_savings,
  }))
  const accountRows = accountList.map(account => {
    const balanceAccount = balanceAccountsById.get(account.id)!
    return {
      account,
      balance: calculateActiveSavingsTreeBalance(balanceAccount, balanceAccounts, balanceTransactions),
      archivedBalance: calculateSavingsAccountTreeBalance(balanceAccount, balanceAccounts, balanceTransactions),
    }
  })
  const accountRowsById = new Map(accountRows.map(row => [row.account.id, row] as const))
  const accountsByParentId = new Map<string, FinanceSavingsAccount[]>()
  for (const account of accountList) {
    if (!account.parent_id) continue
    const children = accountsByParentId.get(account.parent_id) ?? []
    children.push(account)
    accountsByParentId.set(account.parent_id, children)
  }

  const monthlyPlanTotal = sumMoney(monthlyPlanItems.map(item => financeMinorUnitsToMoney(item.amount_minor)))
  const monthlyPlanContent = <>
    <div className="finance-savings-acceptance">
      {months.length === 0 ? <p className="panel-message">Utwórz miesiąc w budżecie, aby przygotować plan oszczędności.</p> : <>
        <label className="finance-month-select">Miesiąc
          <select value={selectedMonthId} onChange={event => selectMonth(event.target.value)}>
            {months.map(month => <option value={month.id} key={month.id}>{monthLabel(month)}</option>)}
          </select>
        </label>
        <p className="panel-message">Plan miesięczny jest zapisany w tej przeglądarce dla Twojego konta i wybranego miesiąca. Akceptacja utworzy rzeczywiste transakcje z datą pierwszego dnia miesiąca.</p>
        <form className="finance-savings-plan-form" onSubmit={submitMonthlyPlanItem}>
          <label>Konto<select required value={planAccountId} onChange={event => setPlanAccountId(event.target.value)} disabled={acceptMonthlyPlan.isPending}>
            {activeAccounts.map(account => <option key={account.id} value={account.id}>{accountPathLabel(account, accountList)} · {privacyLabel(account.visibility)}</option>)}
          </select></label>
          <label>Kwota<input required inputMode="decimal" value={planAmount} onChange={event => setPlanAmount(event.target.value)} placeholder="0,00" disabled={acceptMonthlyPlan.isPending} /></label>
          <label>Opis<input maxLength={2000} value={planDescription} onChange={event => setPlanDescription(event.target.value)} placeholder="Opcjonalny opis" disabled={acceptMonthlyPlan.isPending} /></label>
          <button className="primary-button" type="submit" disabled={!selectedMonthId || !activeAccounts.length || acceptMonthlyPlan.isPending}>Dodaj do planu</button>
        </form>
        {planError && <p className="error-message finance-error" role="alert">{planError}</p>}
        <h3 className="finance-subheading">Zapisane szablony</h3>
        {templates.isPending && <p className="panel-message" role="status">Ładuję szablony…</p>}
        {!templates.isPending && templateList.length === 0 && <p className="panel-message">Nie ma szablonów. Możesz dodać własne pozycje do planu powyżej.</p>}
        <div className="finance-savings-acceptance-list">
          {templateList.map(template => {
            const account = accountList.find(candidate => candidate.id === template.account_id)
            const alreadyAdded = monthlyPlanItems.some(item => item.template_id === template.id)
            const canAdd = template.plan_type !== 'irregular' && account !== undefined
              && !isSavingsAccountArchived(account, accountList) && BigInt(template.monthly_amount) > 0n
            return <div className="finance-savings-acceptance-row" key={template.id}>
              <div className="finance-transfer-copy">
                <strong>{template.name}</strong>
                <span>{account ? `${accountPathLabel(account, accountList)} · ${privacyLabel(account.visibility)}` : 'Szablon bez dostępnego konta'}</span>
                {!canAdd && <span className="finance-savings-skip-reason">Połącz szablon z aktywnym kontem i ustaw dodatnią kwotę miesięczną.</span>}
              </div>
              <strong className="finance-savings-transaction-amount">{formatPln(financeMinorUnitsToMoney(template.monthly_amount))}</strong>
              <button className="button-quiet" type="button" disabled={!canAdd || alreadyAdded || acceptMonthlyPlan.isPending}
                onClick={() => addTemplateToMonthlyPlan(template)}>{alreadyAdded ? 'Dodano' : 'Dodaj szablon'}</button>
            </div>
          })}
        </div>
        <h3 className="finance-subheading">Pozycje planu · {activeMonthForPlan ? monthLabel(activeMonthForPlan) : ''}</h3>
        {monthlyPlanItems.length === 0 && <p className="panel-message">Plan jest pusty. Dodaj własną pozycję albo wybierz zapisany szablon.</p>}
        {monthlyPlanItems.map(item => <MonthlySavingsPlanItemEditor key={item.id} item={item}
          accounts={accountList.filter(account => !isSavingsAccountArchived(account, accountList) || account.id === item.account_id)}
          pending={acceptMonthlyPlan.isPending}
          onSave={changes => updateMonthlyPlanItem(item.id, changes)}
          onRemove={() => removeMonthlyPlanItem(item.id)} />)}
        <p className="finance-savings-acceptance-summary">Suma planu: <strong>{formatPln(monthlyPlanTotal)}</strong></p>
        <button className="primary-button finance-savings-accept-button" type="button" onClick={acceptPlan}
          disabled={!selectedMonthId || monthlyPlanItems.length === 0 || acceptMonthlyPlan.isPending}>
          {acceptMonthlyPlan.isPending ? 'Zapisuję transakcje…' : `Akceptuj ${polishCount(monthlyPlanItems.length, 'pozycję', 'pozycje', 'pozycji')}`}
        </button>
        {acceptanceError && <p className="error-message finance-error" role="alert">{acceptanceError}</p>}
        {acceptedCount > 0 && <p className="panel-message" role="status">Zapisano {polishCount(acceptedCount, 'rzeczywistą transakcję', 'rzeczywiste transakcje', 'rzeczywistych transakcji')}. Saldo uwzględnia zapisane transakcje.</p>}
      </>}
    </div>
  </>
  const accountForm = <>
    <form className="finance-savings-account-form" onSubmit={submitNewAccount}>
        <label>Nazwa konta
          <input required maxLength={160} value={accountName} onChange={event => setAccountName(event.target.value)} placeholder="Nazwa konta" />
        </label>
        <label>Typ
          <select value={accountType} onChange={event => setAccountType(event.target.value as FinanceSavingsAccountType)}>
            {Object.entries(accountTypeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Zakres
          <select value={accountList.find(account => account.id === parentAccountId)?.visibility ?? visibility} disabled={Boolean(parentAccountId)} onChange={event => setVisibility(event.target.value as FinanceVisibility)}>
            <option value="private">Prywatne</option>
            <option value="household">Domowe</option>
          </select>
        </label>
        <label>Konto nadrzędne
          <select value={parentAccountId} onChange={event => setParentAccountId(event.target.value)}>
            <option value="">Brak · konto główne</option>
            {activeAccounts.map(account => <option value={account.id} key={account.id}>{accountPathLabel(account, accountList)} · {privacyLabel(account.visibility)}</option>)}
          </select>
        </label>
        <label>Saldo początkowe
          <input required inputMode="decimal" value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} />
        </label>
        <label>Cel (opcjonalnie)
          <input inputMode="decimal" value={targetAmount} onChange={event => setTargetAmount(event.target.value)} placeholder="0,00" />
        </label>
        <button className="primary-button" type="submit" disabled={saveAccount.isPending}>
          {saveAccount.isPending ? 'Zapisuję konto…' : 'Dodaj konto'}
        </button>
    </form>
    {saveAccount.isError && !saveAccount.variables?.account_id && <p className="error-message finance-error" role="alert">{errorText(saveAccount.error)}</p>}
  </>
  const activeAccountIds = new Set(activeAccounts.map(account => account.id))
  const archivedAccountRows = accountRows.filter(({ account }) => !activeAccountIds.has(account.id))
  const archivedAccountIds = new Set(archivedAccountRows.map(({ account }) => account.id))
  const rootAccountRows = accountRows.filter(({ account }) => activeAccountIds.has(account.id)
    && (!account.parent_id || !activeAccountIds.has(account.parent_id)))
  const archivedRootAccountRows = archivedAccountRows.filter(({ account }) => !account.parent_id || !archivedAccountIds.has(account.parent_id))

  function renderAccountManagementCard(
    account: FinanceSavingsAccount,
    visibleAccountIds: ReadonlySet<string>,
    ancestors = new Set<string>(),
  ) {
    if (ancestors.has(account.id)) return null
    const row = accountRowsById.get(account.id)
    if (!row) return null
    const nextAncestors = new Set([...ancestors, account.id])
    const children = (accountsByParentId.get(account.id) ?? []).filter(child => visibleAccountIds.has(child.id))
    const accountArchived = isSavingsAccountArchived(account, accountList)
    const displayedBalance = accountArchived ? row.archivedBalance : row.balance
    return <div className="finance-account-tree-node" key={account.id}>
      <div className={`finance-savings-account-card${account.parent_id ? ' finance-subaccount-card' : ''}${accountArchived ? ' is-archived' : ''}`}>
        <button className="finance-savings-account-select" type="button" onClick={() => setSelectedAccountId(account.id)} aria-pressed={selectedAccountId === account.id}>
          <span className="finance-savings-account-copy">
            <strong>{account.name}</strong>
            {accountArchived
              ? <span>{accountTypeNames[account.account_type]}</span>
              : <>
                  <span>{accountTypeNames[account.account_type]} · {privacyLabel(account.visibility)}</span>
                  {account.target_amount && <span>Cel: {formatPln(financeMinorUnitsToMoney(account.target_amount))}</span>}
                </>}
          </span>
          {accountArchived
            ? <strong className="finance-savings-account-total">{formatPln(displayedBalance)}</strong>
            : <strong className="finance-savings-account-total">{formatPln(displayedBalance)}</strong>}
        </button>
        {mode === 'accounts' && <SavingsAccountLifecycle
          api={api}
          account={account}
          userId={userId}
          inactive={accountArchived}
          onSaveAccount={saveEditedAccount}
        />}
      </div>
      {children.length > 0 && <div className="finance-account-management-children" role="group" aria-label={'Subkonta konta ' + account.name}>
        {children.map(child => renderAccountManagementCard(child, visibleAccountIds, nextAncestors))}
      </div>}
    </div>
  }

  const accountListContent = <>
    {rootAccountRows.length === 0 && !accounts.isPending && <p className="panel-message">{archivedAccountRows.length > 0 ? 'Brak aktywnych kont.' : 'Nie ma jeszcze dostępnych kont oszczędnościowych.'}</p>}
    <div className="finance-savings-account-list">
      {rootAccountRows.map(({ account }) => renderAccountManagementCard(account, activeAccountIds))}
    </div>
    {archivedAccountRows.length > 0 && <section className="finance-archived-savings-accounts" aria-label="Archiwalne konta">
      <h3 className="finance-subheading">Archiwalne konta</h3>
      <div className="finance-savings-account-list">
        {archivedRootAccountRows.map(({ account }) => renderAccountManagementCard(account, archivedAccountIds))}
      </div>
    </section>}
  </>
  const transactionForm = <details className="panel finance-panel finance-savings-accordion">
    <summary className="finance-savings-accordion-summary"><span><strong>Nowa transakcja</strong><small>Dodaj wpłatę lub wypłatę na wybranym koncie.</small></span></summary>
    <div className="finance-savings-accordion-content finance-savings-form-content">{selectedAccountActive && <>
          <form className="finance-savings-transaction-form" onSubmit={submitTransaction}>
            <label>Konto<select value={selectedAccountId} onChange={event => setSelectedAccountId(event.target.value)}>{activeAccounts.map(account => <option key={account.id} value={account.id}>{accountPathLabel(account, accountList)} · {privacyLabel(account.visibility)}</option>)}</select></label>
            <label>Rodzaj
              <select value={transactionDirection} onChange={event => setTransactionDirection(event.target.value as TransactionDirection)}>
                <option value="deposit">Wpłata</option>
                <option value="withdrawal">Wypłata</option>
              </select>
            </label>
            <label>Kwota
              <input required min="0.01" step="0.01" inputMode="decimal" value={transactionAmount} onChange={event => setTransactionAmount(event.target.value)} placeholder="0,00" />
            </label>
            <label>Data<input required type="date" value={transactionDate} onChange={event => setTransactionDate(event.target.value)} /></label>
            <label>Opis<input maxLength={2000} value={transactionDescription} onChange={event => setTransactionDescription(event.target.value)} placeholder="Opcjonalny opis" /></label>
            <label className="finance-checkbox-label"><input type="checkbox" checked={excludeFromSavings} onChange={event => setExcludeFromSavings(event.target.checked)} /> Nie uwzględniaj w miesięcznych oszczędnościach</label>
            <button className="primary-button" type="submit" disabled={saveTransaction.isPending}>
              {saveTransaction.isPending ? 'Zapisuję transakcję…' : 'Dodaj transakcję'}
            </button>
          </form>
          {transactionFormError && <p className="error-message finance-error finance-savings-feedback" role="alert">{transactionFormError}</p>}
          {saveTransaction.isError && !transactionToggleError && <p className="error-message finance-error finance-savings-feedback" role="alert">{errorText(saveTransaction.error)}</p>}
          </>}
      {!selectedAccountActive && <p className="panel-message finance-savings-feedback">Wybierz aktywne konto, aby dodać transakcję.</p>}
    </div>
  </details>
  const historyContent = <>      {selectedAccount && (
        <div className="finance-savings-transactions">
          {!selectedAccountActive && <p className="panel-message">Historia zarchiwizowanego konta. Przywróć je oraz ewentualne zarchiwizowane konto nadrzędne, aby dodawać lub edytować transakcje.</p>}
          {transactions.isPending && <p className="panel-message" role="status">Ładuję historię konta…</p>}
          {selectedTransactions.length === 0 && !transactions.isPending && <p className="panel-message">To konto nie ma jeszcze transakcji.</p>}
          {selectedTransactions.map(transaction => {
            const isTransfer = transaction.transfer_id !== null
            const transactionAmountMinor = BigInt(transaction.amount)
            const transferCounterpart = isTransfer
              ? transactionList.find(candidate => candidate.transfer_id === transaction.transfer_id && candidate.id !== transaction.id)
              : undefined
            const transferFromId = isTransfer
              ? (transactionAmountMinor < 0n ? transaction.account_id : transferCounterpart?.account_id)
              : undefined
            const transferToId = isTransfer
              ? (transactionAmountMinor > 0n ? transaction.account_id : transferCounterpart?.account_id)
              : undefined
            const transferFromName = transferFromId ? accountList.find(account => account.id === transferFromId)?.name : undefined
            const transferToName = transferToId ? accountList.find(account => account.id === transferToId)?.name : undefined
            const transferLabel = transferFromName && transferToName
              ? `Przelew · ${transferFromName} → ${transferToName}`
              : 'Przelew między kontami'
            const transactionLabel = transaction.description || transaction.transaction_date
            const transactionAmountTone = transactionAmountMinor > 0n
              ? 'is-positive'
              : transactionAmountMinor < 0n ? 'is-negative' : ''
            return (
              <div className={`finance-savings-transaction-row${isTransfer ? ' is-transfer' : ''}`} key={transaction.id}>
                {isTransfer ? <>
                  <div className="finance-transfer-copy">
                    <strong>{transferLabel}</strong>
                    <span>{transaction.transaction_date}</span>
                  </div>
                  <strong className={`finance-savings-transaction-amount ${transactionAmountTone}`}>{formatPln(financeMinorUnitsToMoney(transaction.amount))}</strong>
                </> : <button
                  className="finance-savings-transaction-open"
                  type="button"
                  aria-label={`Edytuj transakcję: ${transactionLabel}`}
                  onClick={() => startTransactionEdit(transaction)}
                  disabled={!selectedAccountActive || saveTransaction.isPending || deleteTransaction.isPending}
                >
                  <span className="finance-transfer-copy">
                    <strong>{transaction.description || 'Transakcja oszczędnościowa'}</strong>
                    <span>{transaction.transaction_date}</span>
                  </span>
                  <strong className={`finance-savings-transaction-amount ${transactionAmountTone}`}>{formatPln(financeMinorUnitsToMoney(transaction.amount))}</strong>
                </button>}
                <label className="finance-savings-monthly-toggle">
                  <input
                    type="checkbox"
                    checked={transactionAmountMinor > 0n && !transaction.excluded_from_monthly_savings && !isTransfer}
                    disabled={transactionAmountMinor <= 0n || isTransfer || !selectedAccountActive || saveTransaction.isPending || deleteTransaction.isPending}
                    aria-label={`Wliczaj transakcję ${transactionLabel} do miesięcznych oszczędności`}
                    onChange={event => setTransactionMonthlySavingsStatus(transaction, event.target.checked)}
                  />
                  Wliczaj
                </label>
                {!isTransfer && (
                  <button className="button-quiet finance-edit-button finance-budget-edit-button finance-budget-delete-button" type="button" aria-label={`Usuń transakcję: ${transactionLabel}`} title="Usuń transakcję" onClick={() => deleteTransaction.mutate(transaction)} disabled={deleteTransaction.isPending || saveTransaction.isPending}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg></button>
                )}
              </div>
            )
          })}
          {transactionToggleError && <p className="error-message finance-error finance-savings-feedback" role="alert">{transactionToggleError}</p>}
          {deleteTransaction.isError && <p className="error-message finance-error" role="alert">{errorText(deleteTransaction.error)}</p>}
          {editingTransaction && (
            <dialog
              ref={swipeTransactionDialogRef}
              className="finance-transaction-dialog"
              aria-labelledby="finance-transaction-dialog-title"
              onCancel={event => {
                event.preventDefault()
                if (!saveTransaction.isPending) closeTransactionEdit()
              }}
              onClick={event => {
                if (event.target === event.currentTarget && !saveTransaction.isPending) closeTransactionEdit()
              }}
            >
              <form className="finance-transaction-dialog-form" onSubmit={event => submitTransactionEdit(event, editingTransaction)}>
                <header className="finance-transaction-dialog-header">
                  <button className="button-quiet finance-transaction-dialog-close" type="button" aria-label="Anuluj edycję" onClick={closeTransactionEdit} disabled={saveTransaction.isPending}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  </button>
                  <h2 id="finance-transaction-dialog-title">Edycja transakcji</h2>
                  <span aria-hidden="true" />
                </header>
                <div className="finance-transaction-dialog-body">
                  <label>Rodzaj
                    <select value={editTransactionDirection} onChange={event => setEditTransactionDirection(event.target.value as TransactionDirection)} disabled={saveTransaction.isPending}>
                      <option value="deposit">Wpłata</option>
                      <option value="withdrawal">Wypłata</option>
                    </select>
                  </label>
                  <label>Kwota
                    <input required min="0.01" step="0.01" inputMode="decimal" value={editTransactionAmount} onChange={event => setEditTransactionAmount(event.target.value)} disabled={saveTransaction.isPending} />
                  </label>
                  <label>Data<input required type="date" value={editTransactionDate} onChange={event => setEditTransactionDate(event.target.value)} disabled={saveTransaction.isPending} /></label>
                  <label>Opis<input maxLength={2000} value={editTransactionDescription} onChange={event => setEditTransactionDescription(event.target.value)} disabled={saveTransaction.isPending} /></label>
                  <label className="finance-savings-monthly-toggle finance-transaction-dialog-monthly-toggle">
                    <input
                      type="checkbox"
                      checked={editTransactionDirection === 'deposit' && !editExcludeFromSavings}
                      disabled={editTransactionDirection === 'withdrawal' || saveTransaction.isPending}
                      onChange={event => setEditExcludeFromSavings(!event.target.checked)}
                    />
                    Wliczaj do miesięcznych oszczędności
                  </label>
                  {transactionEditFormError && <p className="error-message finance-error" role="alert">{transactionEditFormError}</p>}
                  {saveTransaction.isError && !transactionToggleError && <p className="error-message finance-error" role="alert">{errorText(saveTransaction.error)}</p>}
                </div>
                <footer className="finance-transaction-dialog-actions">
                  <button className="button-quiet" type="button" onClick={closeTransactionEdit} disabled={saveTransaction.isPending}>Anuluj</button>
                  <button className="primary-button" type="submit" disabled={saveTransaction.isPending}>
                    {saveTransaction.isPending ? 'Zapisuję…' : 'Zapisz zmiany'}
                  </button>
                </footer>
              </form>
            </dialog>
          )}
        </div>
      )}</>
  const errors = <>
    {accounts.isError && <p className="error-message" role="alert">{errorText(accounts.error)}</p>}
    {transactions.isError && <p className="error-message" role="alert">{errorText(transactions.error)}</p>}
    {mode === 'planner' && templates.isError && <p className="error-message" role="alert">{errorText(templates.error)}</p>}
  </>
  function renderSummaryAccount(account: FinanceSavingsAccount, ancestors = new Set<string>()) {
    if (ancestors.has(account.id)) return null
    const nextAncestors = new Set([...ancestors, account.id])
    const balance = accountRowsById.get(account.id)?.balance ?? '0.00'
    const children = activeAccounts.filter(child => child.parent_id === account.id)
    return <details className="finance-account-summary" key={account.id} open={expandedSummaryAccountIds.has(account.id)} onToggle={event => {
      if (event.target !== event.currentTarget) return
      if (event.currentTarget.open) {
        setExpandedSummaryAccountId(account.id)
        setSelectedAccountId(account.id)
        return
      }
      setExpandedSummaryAccountId(current => {
        let expandedAccount = activeAccounts.find(candidate => candidate.id === current)
        while (expandedAccount) {
          if (expandedAccount.id === account.id) return ''
          expandedAccount = expandedAccount.parent_id
            ? activeAccounts.find(candidate => candidate.id === expandedAccount?.parent_id)
            : undefined
        }
        return current
      })
    }}>
      <summary><span><strong>{account.name}</strong><small>{accountTypeNames[account.account_type]} · {privacyLabel(account.visibility)}</small></span><strong className="finance-savings-account-total">{formatPln(balance)}<small>{children.length > 0 ? 'Saldo razem z podkontami' : 'Saldo konta'}</small></strong></summary>
      {account.target_amount && BigInt(account.target_amount) > 0n && <progress className="finance-goal-progress" max={100} value={Math.min(100, Math.max(0, moneyRatio(balance, financeMinorUnitsToMoney(account.target_amount)) * 100))} aria-label={`Postęp celu: ${account.name}`} />}
      {children.length > 0 && <div className="finance-subaccount-list">{children.map(child => renderSummaryAccount(child, nextAncestors))}</div>}
      {expandedSummaryAccountId === account.id && historyContent}
    </details>
  }
  const summaryTree = <div className="finance-savings-account-list">{activeAccounts.filter(account => !account.parent_id || !activeAccounts.some(parent => parent.id === account.parent_id)).map(account => renderSummaryAccount(account))}
    {!activeAccounts.length && <p className="panel-message">Brak aktywnych kont. Dodaj konto w zakładce Konta.</p>}
  </div>
  if (mode === 'summary') return <FinanceSummariesPanel api={api} householdId={householdId} userId={userId} months={months} selectedMonthId={selectedMonthId}
    actions={<>{transactionForm}<SavingsTransfersPanel api={api} householdId={householdId} userId={userId} /></>}>
    <section className="panel finance-panel"><div className="panel-head"><h2 className="panel-title">Konta</h2></div>{summaryTree}</section>
  </FinanceSummariesPanel>
  if (mode === 'accounts') return <div className="finance-page-stack">
    <details className="panel finance-panel finance-savings-accordion finance-savings-account-create">
      <summary className="finance-savings-accordion-summary"><span><strong>Dodaj konto</strong><small>Utwórz konto lub subkonto oszczędnościowe.</small></span></summary>
      <div className="finance-savings-accordion-content finance-savings-form-content">{accountForm}</div>
    </details>
    <section className="panel finance-panel">
      <div className="panel-head"><div><h2 className="panel-title">Konta</h2><p className="panel-kicker">Zarządzaj kontami, subkontami i celami oszczędnościowymi.</p></div></div>
      {errors}{accounts.isPending && <p className="panel-message" role="status">Ładuję konta…</p>}{accountListContent}
    </section>
  </div>
  const activeBalance = sumMoney(accountRows.filter(({ account }) => !account.parent_id).map(row => row.balance))
  return <div className="finance-page-stack">
    {errors}
    <FinanceKpis values={[
      { label: 'Planowane wpłaty', value: formatPln(monthlyPlanTotal) },
      { label: 'Aktualny stan kont', value: formatPln(activeBalance) },
      { label: 'Stan po akceptacji', value: formatPln(addMoney(activeBalance, monthlyPlanTotal)) },
    ]} />
    <section className="panel finance-panel"><div className="panel-head"><h2 className="panel-title">Plan dla miesiąca</h2></div>{monthlyPlanContent}</section>
    {!accounts.isPending && !transactions.isPending && !templates.isPending && !accounts.isError && !transactions.isError && !templates.isError && <section className="panel finance-management-panel">
      <div className="panel-head"><h2 className="panel-title">Saldo z planem</h2></div>
      {accountRows.filter(({ account }) => !account.parent_id && !isSavingsAccountArchived(account, accountList)).map(({ account, balance }) => {
        const projected = calculateActiveSavingsTreeBalance(
          { ...account, opening_balance: financeMinorUnitsToMoney(account.opening_balance) },
          accountList.map(item => ({ ...item, opening_balance: financeMinorUnitsToMoney(item.opening_balance) })),
          [...transactionList.map(item => ({ ...item, amount: financeMinorUnitsToMoney(item.amount) })), ...monthlyPlanItems.map(item => ({ account_id: item.account_id, amount: financeMinorUnitsToMoney(item.amount_minor) }))],
        )
        return <div className="finance-management-row" key={account.id}><strong>{account.name}</strong><span>{formatPln(balance)} → <strong>{formatPln(projected)}</strong></span></div>
      })}
    </section>}
  </div>
}
