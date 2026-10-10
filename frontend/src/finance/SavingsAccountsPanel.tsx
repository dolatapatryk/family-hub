import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculateSavingsAccountTreeBalance,
  getActiveSavingsAccounts,
  previewSavingsDraftAcceptance,
} from './calculations'
import { FinanceVersionConflictError, createFinanceApi } from './api'
import { financeMinorUnitsToMoney, formatPln, moneyToFinanceMinorUnits } from './money'
import type {
  FinanceSavingsAccount,
  FinanceSavingsAccountType,
  FinanceMonth,
  FinancePlannedSavingsTransaction,
  FinanceSavingsDraftAcceptanceResult,
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

function draftSkipReasonLabel(reason: string) {
  switch (reason) {
    case 'zero_amount': return 'Kwota wynosi 0,00; szkic pozostaje w planie.'
    case 'archived_account': return 'Konto lub konto nadrzędne jest zarchiwizowane; szkic pozostaje w planie.'
    case 'already_posted': return 'Ten szkic ma już przypisany ruch; nie zaksięgowano go ponownie.'
    case 'account_inaccessible': return 'Konto jest niedostępne; szkic pozostaje w planie.'
    default: return 'Szkic pominięto i pozostawiono w planie.'
  }
}

function polishCount(count: number, singular: string, few: string, many: string) {
  const lastTwo = count % 100
  const last = count % 10
  if (count === 1) return `${count} ${singular}`
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} ${few}`
  return `${count} ${many}`
}

export function SavingsAccountsPanel({
  api,
  householdId,
  userId,
  months,
  selectedMonthId,
  onSelectMonth,
}: {
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
  const [editingAccountId, setEditingAccountId] = useState('')
  const [editAccountName, setEditAccountName] = useState('')
  const [editAccountType, setEditAccountType] = useState<FinanceSavingsAccountType>('cash')
  const [editTargetAmount, setEditTargetAmount] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [transactionDirection, setTransactionDirection] = useState<TransactionDirection>('deposit')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [transactionDate, setTransactionDate] = useState(localDateToday)
  const [transactionDescription, setTransactionDescription] = useState('')
  const [excludeFromSavings, setExcludeFromSavings] = useState(false)
  const [transactionFormError, setTransactionFormError] = useState('')
  const [editingTransactionId, setEditingTransactionId] = useState('')
  const [editTransactionDirection, setEditTransactionDirection] = useState<TransactionDirection>('deposit')
  const [editTransactionAmount, setEditTransactionAmount] = useState('')
  const [editTransactionDate, setEditTransactionDate] = useState('')
  const [editTransactionDescription, setEditTransactionDescription] = useState('')
  const [editExcludeFromSavings, setEditExcludeFromSavings] = useState(false)
  const [transactionEditFormError, setTransactionEditFormError] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftFormError, setDraftFormError] = useState('')
  const [editingDraftId, setEditingDraftId] = useState('')
  const [editDraftAmount, setEditDraftAmount] = useState('')
  const [editDraftDescription, setEditDraftDescription] = useState('')
  const [editDraftAccountId, setEditDraftAccountId] = useState('')
  const [editDraftMonthId, setEditDraftMonthId] = useState('')
  const [draftEditFormError, setDraftEditFormError] = useState('')
  const [showAcceptancePreview, setShowAcceptancePreview] = useState(false)
  const [acceptanceResult, setAcceptanceResult] = useState<FinanceSavingsDraftAcceptanceResult | null>(null)
  const accountRequests = useRef(new Map<string, string>())
  const transactionRequests = useRef(new Map<string, string>())
  const deleteRequests = useRef(new Map<string, string>())
  const draftRequests = useRef(new Map<string, string>())
  const draftDeleteRequests = useRef(new Map<string, string>())
  const acceptanceRequests = useRef(new Map<string, string>())

  const accountsKey = ['financeSavingsAccounts', householdId, userId] as const
  const transactionsKey = ['financeSavingsTransactions', householdId, userId] as const
  const draftsKey = ['financeSavingsDrafts', householdId, userId, selectedMonthId] as const
  const accounts = useQuery({ queryKey: accountsKey, queryFn: ({ signal }) => api.listSavingsAccounts(signal) })
  const transactions = useQuery({ queryKey: transactionsKey, queryFn: ({ signal }) => api.listSavingsTransactions(signal) })
  const drafts = useQuery({
    queryKey: draftsKey,
    queryFn: ({ signal }) => api.listSavingsDrafts(selectedMonthId, signal),
    enabled: Boolean(selectedMonthId),
  })
  const accountList = accounts.data ?? []
  const activeAccounts = useMemo(() => getActiveSavingsAccounts(accountList), [accountList])
  const transactionList = transactions.data ?? []
  const draftList = drafts.data ?? []
  const acceptancePreview = useMemo(
    () => previewSavingsDraftAcceptance(draftList, accountList),
    [draftList, accountList],
  )
  const readyDraftCount = acceptancePreview.filter(item => item.state === 'ready').length
  const readyDraftTotalMinor = acceptancePreview.reduce(
    (total, item) => item.state === 'ready' ? total + BigInt(item.draft.amount) : total,
    0n,
  )
  const selectedAccount = activeAccounts.find(account => account.id === selectedAccountId)
  const selectedTransactions = transactionList.filter(transaction => transaction.account_id === selectedAccountId)
  const selectedDrafts = draftList.filter(draft => draft.account_id === selectedAccountId)

  useEffect(() => {
    if (!activeAccounts.some(account => account.id === selectedAccountId)) {
      setSelectedAccountId(activeAccounts[0]?.id ?? '')
    }
  }, [activeAccounts, selectedAccountId])

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
    }) => {
      let requestId = accountRequests.current.get(input.signature)
      if (!requestId) {
        requestId = globalThis.crypto.randomUUID()
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
          : null,
        opening_balance: input.opening_balance ?? null,
        target_amount: input.target_amount,
        color: null,
        visibility: input.visibility,
        sort_order: input.account_id
          ? accountList.find(account => account.id === input.account_id)?.sort_order ?? 0
          : accountList.length,
      })
      return input.signature
    },
    onSuccess: async (signature, input) => {
      accountRequests.current.delete(signature)
      if (!input.account_id) {
        setAccountName('')
        setOpeningBalance('0.00')
        setTargetAmount('')
      }
      setEditingAccountId('')
      await invalidateSavings()
    },
    onError: async (error, input) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      accountRequests.current.delete(input.signature)
      setEditingAccountId('')
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
    }) => {
      let requestId = transactionRequests.current.get(input.signature)
      if (!requestId) {
        requestId = globalThis.crypto.randomUUID()
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
        budget_month_id: null,
        excluded_from_monthly_savings: input.excluded_from_monthly_savings,
      })
      return input.signature
    },
    onSuccess: async (signature, input) => {
      transactionRequests.current.delete(signature)
      if (!input.transaction_id) {
        setTransactionAmount('')
        setTransactionDescription('')
        setExcludeFromSavings(false)
      }
      setEditingTransactionId('')
      await invalidateSavings()
    },
    onError: async (error, input) => {
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
        requestId = globalThis.crypto.randomUUID()
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

  const saveDraft = useMutation({
    mutationFn: async (input: {
      signature: string
      draft_id?: string
      expected_version?: number
      month_id: string
      account_id: string
      amount: string
      description: string
      source_savings_plan_id: string | null
    }) => {
      let requestId = draftRequests.current.get(input.signature)
      if (!requestId) {
        requestId = globalThis.crypto.randomUUID()
        draftRequests.current.set(input.signature, requestId)
      }
      await api.saveSavingsDraft({
        request_id: requestId,
        draft_id: input.draft_id ?? null,
        expected_version: input.expected_version ?? null,
        month_id: input.month_id,
        account_id: input.account_id,
        amount: input.amount,
        description: input.description.trim() || null,
        source_savings_plan_id: input.source_savings_plan_id,
      })
      return input.signature
    },
    onSuccess: async (signature, input) => {
      draftRequests.current.delete(signature)
      if (!input.draft_id) {
        setDraftAmount('')
        setDraftDescription('')
      } else {
        setSelectedAccountId(input.account_id)
        selectMonth(input.month_id)
      }
      setEditingDraftId('')
      setDraftEditFormError('')
      await queryClient.invalidateQueries({ queryKey: ['financeSavingsDrafts', householdId, userId] })
    },
    onError: async (error, input) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      draftRequests.current.delete(input.signature)
      setEditingDraftId('')
      await queryClient.invalidateQueries({ queryKey: ['financeSavingsDrafts', householdId, userId] })
    },
  })

  const deleteDraft = useMutation({
    mutationFn: async (draft: FinancePlannedSavingsTransaction) => {
      const signature = `${draft.id}:${draft.version}`
      let requestId = draftDeleteRequests.current.get(signature)
      if (!requestId) {
        requestId = globalThis.crypto.randomUUID()
        draftDeleteRequests.current.set(signature, requestId)
      }
      await api.deleteSavingsDraft({
        request_id: requestId,
        draft_id: draft.id,
        expected_version: draft.version,
      })
      return signature
    },
    onSuccess: async signature => {
      draftDeleteRequests.current.delete(signature)
      await queryClient.invalidateQueries({ queryKey: ['financeSavingsDrafts', householdId, userId] })
    },
    onError: async (error, draft) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      draftDeleteRequests.current.delete(`${draft.id}:${draft.version}`)
      await queryClient.invalidateQueries({ queryKey: ['financeSavingsDrafts', householdId, userId] })
    },
  })

  const acceptDrafts = useMutation({
    mutationFn: async (monthId: string) => {
      let requestId = acceptanceRequests.current.get(monthId)
      if (!requestId) {
        requestId = globalThis.crypto.randomUUID()
        acceptanceRequests.current.set(monthId, requestId)
      }
      return api.acceptSavingsDrafts({ request_id: requestId, month_id: monthId })
    },
    onSuccess: async result => {
      acceptanceRequests.current.delete(result.month_id)
      setAcceptanceResult(result)
      setShowAcceptancePreview(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['financeSavingsDrafts', householdId, userId] }),
        queryClient.invalidateQueries({ queryKey: transactionsKey }),
        queryClient.invalidateQueries({ queryKey: accountsKey }),
      ])
    },
  })

  function selectMonth(monthId: string) {
    onSelectMonth(monthId)
    setShowAcceptancePreview(false)
    setAcceptanceResult(null)
  }

  function startAccountEdit(account: FinanceSavingsAccount) {
    setEditingAccountId(account.id)
    setEditAccountName(account.name)
    setEditAccountType(account.account_type)
    setEditTargetAmount(account.target_amount == null ? '' : financeMinorUnitsToMoney(account.target_amount))
  }

  function submitNewAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const signature = JSON.stringify({ name: accountName.trim(), accountType, openingBalance, targetAmount, visibility })
    saveAccount.mutate({
      signature,
      name: accountName.trim(),
      account_type: accountType,
      opening_balance: openingBalance,
      target_amount: targetAmount.trim() || null,
      visibility,
    })
  }

  function submitAccountEdit(event: FormEvent<HTMLFormElement>, account: FinanceSavingsAccount) {
    event.preventDefault()
    const signature = JSON.stringify({ id: account.id, version: account.version, editAccountName, editAccountType, editTargetAmount })
    saveAccount.mutate({
      signature,
      account_id: account.id,
      expected_version: account.version,
      name: editAccountName.trim(),
      account_type: editAccountType,
      target_amount: editTargetAmount.trim() || null,
      visibility: account.visibility,
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
    setEditingTransactionId(transaction.id)
    setTransactionEditFormError('')
    setEditTransactionDirection(amount < 0n ? 'withdrawal' : 'deposit')
    setEditTransactionAmount(absMoney(transaction.amount))
    setEditTransactionDate(transaction.transaction_date)
    setEditTransactionDescription(transaction.description ?? '')
    setEditExcludeFromSavings(transaction.excluded_from_monthly_savings)
  }

  function submitTransactionEdit(event: FormEvent<HTMLFormElement>, transaction: FinanceSavingsTransaction) {
    event.preventDefault()
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

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedAccount || !selectedMonthId) return
    try {
      moneyToFinanceMinorUnits(draftAmount)
      setDraftFormError('')
    } catch (error) {
      setDraftFormError(errorText(error))
      return
    }
    const description = draftDescription.trim()
    const signature = JSON.stringify({
      month_id: selectedMonthId,
      account_id: selectedAccount.id,
      amount: draftAmount,
      description,
      source_savings_plan_id: null,
    })
    saveDraft.mutate({
      signature,
      month_id: selectedMonthId,
      account_id: selectedAccount.id,
      amount: draftAmount,
      description,
      source_savings_plan_id: null,
    })
  }

  function startDraftEdit(draft: FinancePlannedSavingsTransaction) {
    setEditingDraftId(draft.id)
    setDraftEditFormError('')
    setEditDraftAmount(financeMinorUnitsToMoney(draft.amount))
    setEditDraftDescription(draft.description ?? '')
    setEditDraftAccountId(draft.account_id)
    setEditDraftMonthId(draft.month_id)
  }

  function submitDraftEdit(event: FormEvent<HTMLFormElement>, draft: FinancePlannedSavingsTransaction) {
    event.preventDefault()
    if (!activeAccounts.some(account => account.id === editDraftAccountId)
      || !months.some(month => month.id === editDraftMonthId)) {
      setDraftEditFormError('Wybierz dostępne konto i miesiąc.')
      return
    }
    try {
      moneyToFinanceMinorUnits(editDraftAmount)
      setDraftEditFormError('')
    } catch (error) {
      setDraftEditFormError(errorText(error))
      return
    }
    const description = editDraftDescription.trim()
    const signature = JSON.stringify({
      id: draft.id,
      version: draft.version,
      month_id: editDraftMonthId,
      account_id: editDraftAccountId,
      amount: editDraftAmount,
      description,
      source_savings_plan_id: draft.source_savings_plan_id,
    })
    saveDraft.mutate({
      signature,
      draft_id: draft.id,
      expected_version: draft.version,
      month_id: editDraftMonthId,
      account_id: editDraftAccountId,
      amount: editDraftAmount,
      description,
      source_savings_plan_id: draft.source_savings_plan_id,
    })
  }

  const accountRows = accountList.map(account => ({
    account,
    balance: calculateSavingsAccountTreeBalance(
      {
        id: account.id,
        opening_balance: financeMinorUnitsToMoney(account.opening_balance),
        parent_id: account.parent_id,
        is_archived: account.is_archived,
      },
      accountList.map(candidate => ({
        id: candidate.id,
        opening_balance: financeMinorUnitsToMoney(candidate.opening_balance),
        parent_id: candidate.parent_id,
        is_archived: candidate.is_archived,
      })),
      transactionList.map(transaction => ({
        account_id: transaction.account_id,
        amount: financeMinorUnitsToMoney(transaction.amount),
        transaction_date: transaction.transaction_date,
        excluded_from_monthly_savings: transaction.excluded_from_monthly_savings,
      })),
    ),
  }))

  return (
    <section className="panel finance-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Konta oszczędnościowe</h2>
          <p className="panel-kicker">Konta prywatne widzi tylko ich właściciel. Zmiany salda i historia uwzględniają wszystkie ruchy.</p>
        </div>
        {months.length > 0 && (
          <label className="finance-month-select">Miesiąc planu
            <select value={selectedMonthId} onChange={event => selectMonth(event.target.value)}>
              {months.map(month => <option value={month.id} key={month.id}>{monthLabel(month)}</option>)}
            </select>
          </label>
        )}
      </div>

      {accounts.isPending && <p className="panel-message" role="status">Ładuję konta…</p>}
      {accounts.isError && <p className="error-message finance-error" role="alert">{errorText(accounts.error)}</p>}
      {transactions.isError && <p className="error-message finance-error" role="alert">{errorText(transactions.error)}</p>}
      {drafts.isError && <p className="error-message finance-error" role="alert">{errorText(drafts.error)}</p>}

      {selectedMonthId && months.length > 0 && (
        <section className="finance-savings-acceptance" aria-label="Przyjmowanie planowanych ruchów oszczędnościowych">
          <div className="finance-savings-acceptance-head">
            <div>
              <h3 className="finance-subheading">Przyjmij plany · {monthLabel(months.find(month => month.id === selectedMonthId) ?? months[0])}</h3>
              <p className="panel-message">Podgląd obejmuje dostępne szkice z wybranego miesiąca. Konto prywatne innej osoby nie jest tu widoczne ani księgowane; jego szkice pozostają w planie do przyjęcia przez właściciela.</p>
              <p className="panel-message">Przyjęte ruchy otrzymają datę pierwszego dnia miesiąca i zachowają identyfikator źródłowego szkicu.</p>
            </div>
            <button
              className="button-quiet"
              type="button"
              onClick={() => setShowAcceptancePreview(open => !open)}
              aria-expanded={showAcceptancePreview}
            >
              {showAcceptancePreview ? 'Ukryj podgląd' : 'Podgląd przyjęcia'}
            </button>
          </div>

          {showAcceptancePreview && (
            <div className="finance-savings-acceptance-body">
              {drafts.isPending && <p className="panel-message" role="status">Ładuję szkice do podglądu…</p>}
              {!drafts.isPending && !drafts.isError && draftList.length === 0 && (
                <p className="panel-message">W tym miesiącu nie ma dostępnych szkiców do przyjęcia.</p>
              )}
              {acceptancePreview.length > 0 && (
                <>
                  <p className="finance-savings-acceptance-summary">
                    Do przyjęcia: <strong>{readyDraftCount}</strong> · suma: <strong>{formatPln(financeMinorUnitsToMoney(readyDraftTotalMinor.toString()))}</strong> · pominięte: <strong>{acceptancePreview.length - readyDraftCount}</strong>
                  </p>
                  <div className="finance-savings-acceptance-list">
                    {acceptancePreview.map(({ draft, state, reasons }) => {
                      const account = accountList.find(candidate => candidate.id === draft.account_id)
                      return (
                        <div className="finance-savings-acceptance-row" key={draft.id}>
                          <div className="finance-transfer-copy">
                            <strong>{draft.description || 'Planowany ruch oszczędnościowy'}</strong>
                            <span>{account ? `${account.name} · ${privacyLabel(account.visibility)}` : 'Konto niedostępne'}{draft.source_savings_plan_id ? ' · źródłowy plan oszczędności' : ''}</span>
                            {reasons.map(reason => <span className="finance-savings-skip-reason" key={reason}>{draftSkipReasonLabel(reason)}</span>)}
                          </div>
                          <strong className="finance-savings-transaction-amount">{formatPln(financeMinorUnitsToMoney(draft.amount))}</strong>
                          <span className={`finance-savings-acceptance-status ${state}`}>
                            {state === 'ready' ? 'Do przyjęcia' : 'Pozostaje w planie'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    className="primary-button finance-savings-accept-button"
                    type="button"
                    onClick={() => acceptDrafts.mutate(selectedMonthId)}
                    disabled={acceptDrafts.isPending || drafts.isPending || draftList.length === 0}
                  >
                    {acceptDrafts.isPending
                      ? 'Przyjmuję szkice…'
                      : `Przyjmij ${polishCount(readyDraftCount, 'ruch', 'ruchy', 'ruchów')}`}
                  </button>
                </>
              )}
              {acceptDrafts.isError && <p className="error-message finance-error" role="alert">{errorText(acceptDrafts.error)}</p>}
              {acceptanceResult?.month_id === selectedMonthId && (
                <section className="finance-savings-acceptance-result" aria-live="polite">
                  <h4>Wynik przyjęcia · {acceptanceResult.month_start}</h4>
                  <p className="panel-message">
                    Zaksięgowano {polishCount(acceptanceResult.posted_count, 'ruch', 'ruchy', 'ruchów')}. Pominięto {polishCount(acceptanceResult.skipped_count, 'szkic', 'szkice', 'szkiców')}; pozostają w planie.
                  </p>
                  {acceptanceResult.posted.map(entry => (
                    <div className="finance-savings-acceptance-row" key={entry.draft_id}>
                      <div className="finance-transfer-copy">
                        <strong>{entry.description || 'Ruch oszczędnościowy'}</strong>
                        <span>{accountList.find(account => account.id === entry.account_id)?.name ?? 'Konto'} · przyjęto z planu</span>
                      </div>
                      <strong className="finance-savings-transaction-amount">{formatPln(financeMinorUnitsToMoney(entry.amount_minor))}</strong>
                      <span className="finance-savings-acceptance-status ready">Przyjęto</span>
                    </div>
                  ))}
                  {acceptanceResult.skipped.map(entry => (
                    <div className="finance-savings-acceptance-row" key={entry.draft_id}>
                      <div className="finance-transfer-copy">
                        <strong>{entry.description || 'Planowany ruch oszczędnościowy'}</strong>
                        <span>{accountList.find(account => account.id === entry.account_id)?.name ?? 'Konto'} · pozostaje w planie</span>
                        {entry.reasons.map(reason => <span className="finance-savings-skip-reason" key={reason}>{draftSkipReasonLabel(reason)}</span>)}
                      </div>
                      <strong className="finance-savings-transaction-amount">{formatPln(financeMinorUnitsToMoney(entry.amount_minor))}</strong>
                      <span className="finance-savings-acceptance-status skipped">Pominięto</span>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </section>
      )}

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
          <select value={visibility} onChange={event => setVisibility(event.target.value as FinanceVisibility)}>
            <option value="private">Prywatne</option>
            <option value="household">Domowe</option>
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
      {saveAccount.isError && <p className="error-message finance-error" role="alert">{errorText(saveAccount.error)}</p>}

      {accountRows.length === 0 && !accounts.isPending && <p className="panel-message">Nie ma jeszcze dostępnych kont oszczędnościowych.</p>}
      <div className="finance-savings-account-list">
        {accountRows.map(({ account, balance }) => (
          <div className="finance-savings-account-card" key={account.id}>
            <button className="finance-savings-account-select" type="button" onClick={() => setSelectedAccountId(account.id)} aria-pressed={selectedAccountId === account.id} disabled={!activeAccounts.some(active => active.id === account.id)}>
              <span className="finance-savings-account-copy">
                <strong>{account.name}</strong>
                <span>{accountTypeNames[account.account_type]} · {privacyLabel(account.visibility)}{account.is_archived ? ' · Archiwalne' : ''}</span>
              </span>
              <strong>{formatPln(balance)}</strong>
            </button>
            <button className="button-quiet finance-edit-button" type="button" onClick={() => startAccountEdit(account)} disabled={saveAccount.isPending}>Edytuj</button>
            {editingAccountId === account.id && (
              <form className="finance-savings-edit-form" onSubmit={event => submitAccountEdit(event, account)}>
                <label>Nazwa<input required maxLength={160} value={editAccountName} onChange={event => setEditAccountName(event.target.value)} /></label>
                <label>Typ
                  <select value={editAccountType} onChange={event => setEditAccountType(event.target.value as FinanceSavingsAccountType)}>
                    {Object.entries(accountTypeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>Cel<input inputMode="decimal" value={editTargetAmount} onChange={event => setEditTargetAmount(event.target.value)} placeholder="Brak celu" /></label>
                <div className="finance-edit-actions">
                  <button className="primary-button" type="submit" disabled={saveAccount.isPending}>Zapisz konto</button>
                  <button className="button-quiet" type="button" onClick={() => setEditingAccountId('')} disabled={saveAccount.isPending}>Anuluj</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>

      {selectedAccount && (
        <div className="finance-savings-transactions">
          <h3 className="finance-subheading">Ruchy · {selectedAccount.name}</h3>
          <form className="finance-savings-transaction-form" onSubmit={submitTransaction}>
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
              {saveTransaction.isPending ? 'Zapisuję ruch…' : 'Dodaj ruch'}
            </button>
          </form>
          {transactionFormError && <p className="error-message finance-error" role="alert">{transactionFormError}</p>}
          {saveTransaction.isError && <p className="error-message finance-error" role="alert">{errorText(saveTransaction.error)}</p>}
          {transactions.isPending && <p className="panel-message" role="status">Ładuję historię konta…</p>}
          {selectedTransactions.length === 0 && !transactions.isPending && <p className="panel-message">To konto nie ma jeszcze ruchów.</p>}
          {selectedTransactions.map(transaction => {
            const isTransfer = transaction.transfer_id !== null
            const isEditing = editingTransactionId === transaction.id
            if (isEditing && !isTransfer) {
              return (
                <form className="finance-savings-transaction-edit" key={transaction.id} onSubmit={event => submitTransactionEdit(event, transaction)}>
                  <label>Rodzaj
                    <select value={editTransactionDirection} onChange={event => setEditTransactionDirection(event.target.value as TransactionDirection)}>
                      <option value="deposit">Wpłata</option>
                      <option value="withdrawal">Wypłata</option>
                    </select>
                  </label>
                  <label>Kwota<input required min="0.01" step="0.01" inputMode="decimal" value={editTransactionAmount} onChange={event => setEditTransactionAmount(event.target.value)} /></label>
                  <label>Data<input required type="date" value={editTransactionDate} onChange={event => setEditTransactionDate(event.target.value)} /></label>
                  <label>Opis<input maxLength={2000} value={editTransactionDescription} onChange={event => setEditTransactionDescription(event.target.value)} /></label>
                  <label className="finance-checkbox-label"><input type="checkbox" checked={editExcludeFromSavings} onChange={event => setEditExcludeFromSavings(event.target.checked)} /> Nie uwzględniaj w miesięcznych oszczędnościach</label>
                  {transactionEditFormError && <p className="error-message finance-error" role="alert">{transactionEditFormError}</p>}
                  <div className="finance-edit-actions">
                    <button className="primary-button" type="submit" disabled={saveTransaction.isPending}>Zapisz ruch</button>
                    <button className="button-quiet" type="button" onClick={() => { setEditingTransactionId(''); setTransactionEditFormError('') }} disabled={saveTransaction.isPending}>Anuluj</button>
                  </div>
                </form>
              )
            }
            return (
              <div className="finance-savings-transaction-row" key={transaction.id}>
                <div className="finance-transfer-copy">
                  <strong>{isTransfer ? 'Przelew' : transaction.description || 'Ruch oszczędnościowy'}</strong>
                  <span>{transaction.transaction_date}{transaction.excluded_from_monthly_savings ? ' · poza miesięcznymi oszczędnościami' : ''}</span>
                </div>
                <strong className="finance-savings-transaction-amount">{formatPln(financeMinorUnitsToMoney(transaction.amount))}</strong>
                {!isTransfer && (
                  <div className="finance-savings-transaction-actions">
                    <button className="button-quiet finance-edit-button" type="button" onClick={() => startTransactionEdit(transaction)} disabled={saveTransaction.isPending || deleteTransaction.isPending}>Edytuj</button>
                    <button className="button-quiet finance-edit-button" type="button" onClick={() => deleteTransaction.mutate(transaction)} disabled={deleteTransaction.isPending || saveTransaction.isPending}>Usuń</button>
                  </div>
                )}
              </div>
            )
          })}
          {deleteTransaction.isError && <p className="error-message finance-error" role="alert">{errorText(deleteTransaction.error)}</p>}

          <div className="finance-savings-drafts">
            <h3 className="finance-subheading">Planowane ruchy · {selectedAccount.name}</h3>
            {months.length === 0 ? (
              <p className="panel-message">Utwórz miesiąc w budżecie, aby zaplanować ruchy oszczędnościowe.</p>
            ) : (
              <>
                <form className="finance-savings-draft-form" onSubmit={submitDraft}>
                  <label>Kwota
                    <input required inputMode="decimal" value={draftAmount} onChange={event => setDraftAmount(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>Opis
                    <input maxLength={2000} value={draftDescription} onChange={event => setDraftDescription(event.target.value)} placeholder="Opcjonalny opis" />
                  </label>
                  <button className="primary-button" type="submit" disabled={!selectedMonthId || saveDraft.isPending}>
                    {saveDraft.isPending ? 'Zapisuję plan…' : 'Dodaj planowany ruch'}
                  </button>
                </form>
                {draftFormError && <p className="error-message finance-error" role="alert">{draftFormError}</p>}
                {saveDraft.isError && <p className="error-message finance-error" role="alert">{errorText(saveDraft.error)}</p>}
                {drafts.isPending && <p className="panel-message" role="status">Ładuję planowane ruchy…</p>}
                {selectedDrafts.length === 0 && !drafts.isPending && <p className="panel-message">Brak planowanych ruchów w tym miesiącu.</p>}
                {selectedDrafts.map(draft => {
                  if (editingDraftId === draft.id) {
                    return (
                      <form className="finance-savings-draft-edit" key={draft.id} onSubmit={event => submitDraftEdit(event, draft)}>
                        <label>Konto
                          <select
                            required
                            value={editDraftAccountId}
                            onChange={event => setEditDraftAccountId(event.target.value)}
                            disabled={saveDraft.isPending || Boolean(draft.source_savings_plan_id)}
                          >
                            {activeAccounts.map(account => <option value={account.id} key={account.id}>{account.name} · {privacyLabel(account.visibility)}</option>)}
                          </select>
                        </label>
                        <label>Miesiąc
                          <select required value={editDraftMonthId} onChange={event => setEditDraftMonthId(event.target.value)} disabled={saveDraft.isPending}>
                            {months.map(month => <option value={month.id} key={month.id}>{monthLabel(month)}</option>)}
                          </select>
                        </label>
                        <label>Kwota<input required inputMode="decimal" value={editDraftAmount} onChange={event => setEditDraftAmount(event.target.value)} /></label>
                        <label>Opis<input maxLength={2000} value={editDraftDescription} onChange={event => setEditDraftDescription(event.target.value)} /></label>
                        {draft.source_savings_plan_id && <p className="panel-message">Konto jest przypisane do źródłowego planu oszczędności.</p>}
                        {draftEditFormError && <p className="error-message finance-error" role="alert">{draftEditFormError}</p>}
                        <div className="finance-edit-actions">
                          <button className="primary-button" type="submit" disabled={saveDraft.isPending}>Zapisz plan</button>
                          <button className="button-quiet" type="button" onClick={() => { setEditingDraftId(''); setDraftEditFormError('') }} disabled={saveDraft.isPending}>Anuluj</button>
                        </div>
                      </form>
                    )
                  }
                  return (
                    <div className="finance-savings-transaction-row" key={draft.id}>
                      <div className="finance-transfer-copy">
                        <strong>{draft.description || 'Planowany ruch oszczędnościowy'}</strong>
                        <span>{monthLabel(months.find(month => month.id === draft.month_id) ?? months[0])}{draft.source_savings_plan_id ? ' · plan oszczędności' : ''}</span>
                      </div>
                      <strong className="finance-savings-transaction-amount">{formatPln(financeMinorUnitsToMoney(draft.amount))}</strong>
                      <div className="finance-savings-transaction-actions">
                        <button className="button-quiet finance-edit-button" type="button" onClick={() => startDraftEdit(draft)} disabled={saveDraft.isPending || deleteDraft.isPending}>Edytuj</button>
                        <button className="button-quiet finance-edit-button" type="button" onClick={() => deleteDraft.mutate(draft)} disabled={deleteDraft.isPending || saveDraft.isPending}>Usuń</button>
                      </div>
                    </div>
                  )
                })}
                {deleteDraft.isError && <p className="error-message finance-error" role="alert">{errorText(deleteDraft.error)}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
