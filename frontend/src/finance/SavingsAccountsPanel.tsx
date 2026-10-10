import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calculateSavingsAccountTreeBalance, getActiveSavingsAccounts } from './calculations'
import { FinanceVersionConflictError, createFinanceApi } from './api'
import { financeMinorUnitsToMoney, formatPln, moneyToFinanceMinorUnits } from './money'
import type {
  FinanceSavingsAccount,
  FinanceSavingsAccountType,
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

export function SavingsAccountsPanel({
  api,
  householdId,
  userId,
}: {
  api: ReturnType<typeof createFinanceApi>
  householdId: string
  userId: string
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
  const accountRequests = useRef(new Map<string, string>())
  const transactionRequests = useRef(new Map<string, string>())
  const deleteRequests = useRef(new Map<string, string>())

  const accountsKey = ['financeSavingsAccounts', householdId, userId] as const
  const transactionsKey = ['financeSavingsTransactions', householdId, userId] as const
  const accounts = useQuery({ queryKey: accountsKey, queryFn: ({ signal }) => api.listSavingsAccounts(signal) })
  const transactions = useQuery({ queryKey: transactionsKey, queryFn: ({ signal }) => api.listSavingsTransactions(signal) })
  const accountList = accounts.data ?? []
  const activeAccounts = useMemo(() => getActiveSavingsAccounts(accountList), [accountList])
  const transactionList = transactions.data ?? []
  const selectedAccount = activeAccounts.find(account => account.id === selectedAccountId)
  const selectedTransactions = transactionList.filter(transaction => transaction.account_id === selectedAccountId)

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
      </div>

      {accounts.isPending && <p className="panel-message" role="status">Ładuję konta…</p>}
      {accounts.isError && <p className="error-message finance-error" role="alert">{errorText(accounts.error)}</p>}
      {transactions.isError && <p className="error-message finance-error" role="alert">{errorText(transactions.error)}</p>}

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
        </div>
      )}
    </section>
  )
}
