import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileDialogSwipeDismiss } from '../components/useMobileDialogSwipeDismiss'
import { createFinanceApi, FinanceVersionConflictError } from './api'
import { financeMinorUnitsToMoney, formatPln } from './money'
import type {
  FinanceAccountLifecycleAction,
  FinanceAccountLifecycleInput,
  FinanceSavingsAccount,
  FinanceSavingsAccountType,
  FinanceVisibility,
} from './types'
import { createUuid } from '../utils/uuid'

type DialogAction = FinanceAccountLifecycleAction | 'edit' | null

type AccountEditInput = {
  expected_version: number
  name: string
  account_type: FinanceSavingsAccountType
  target_amount: string | null
  visibility: FinanceVisibility
}

const actionNames: Record<FinanceAccountLifecycleAction, string> = {
  archive: 'Archiwizuj konto',
  restore: 'Przywróć konto',
  balance: 'Skoryguj saldo',
  visibility: 'Zmień zakres',
}

function messageForError(error: unknown) {
  return error instanceof Error ? error.message : 'Nie udało się zapisać zmian.'
}

export function SavingsAccountLifecycle({ api, account, userId, inactive, onSaveAccount }: {
  api: ReturnType<typeof createFinanceApi>
  account: FinanceSavingsAccount
  userId: string
  inactive: boolean
  onSaveAccount: (account: FinanceSavingsAccount, input: AccountEditInput) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const requests = useRef(new Map<string, string>())
  const [action, setAction] = useState<DialogAction>(null)
  const [balance, setBalance] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [requestedVisibility, setRequestedVisibility] = useState(account.visibility)
  const [editAccountName, setEditAccountName] = useState(account.name)
  const [editAccountType, setEditAccountType] = useState<FinanceSavingsAccountType>(account.account_type)
  const [editTargetAmount, setEditTargetAmount] = useState(account.target_amount == null ? '' : financeMinorUnitsToMoney(account.target_amount))
  const [editVisibility, setEditVisibility] = useState<FinanceVisibility>(account.visibility)
  const [editExpectedVersion, setEditExpectedVersion] = useState(account.version)
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editAfterVisibility, setEditAfterVisibility] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (action && !dialog.open) dialog.showModal()
    else if (!action && dialog.open) dialog.close()
  }, [action])

  const preview = useMutation({ mutationFn: () => api.previewAccountLifecycle(account.id), onSuccess: data => {
    setBalance(financeMinorUnitsToMoney(data.display_balance_minor))
  } })
  const apply = useMutation({ mutationFn: async (input: Omit<FinanceAccountLifecycleInput, 'request_id'>) => {
    const signature = JSON.stringify(input)
    let requestId = requests.current.get(signature)
    if (!requestId) {
      requestId = createUuid()
      requests.current.set(signature, requestId)
    }
    const result = await api.applyAccountLifecycle({ ...input, request_id: requestId })
    requests.current.delete(signature)
    return result
  } })

  function refresh() {
    return Promise.all(['financeSavingsAccounts', 'financeSavingsTransactions', 'financeSavingsPlans', 'financeSavingsTransfers']
      .map(key => queryClient.invalidateQueries({ queryKey: [key, account.household_id] })))
  }

  function closeDialog() {
    setAction(null)
    setAcknowledged(false)
    setEditError('')
    setEditAfterVisibility(false)
  }

  function startEdit() {
    setEditAccountName(account.name)
    setEditAccountType(account.account_type)
    setEditTargetAmount(account.target_amount == null ? '' : financeMinorUnitsToMoney(account.target_amount))
    setEditVisibility(account.visibility)
    setEditExpectedVersion(account.version)
    setEditError('')
    setEditAfterVisibility(false)
    setAction('edit')
  }

  function startLifecycle(next: FinanceAccountLifecycleAction) {
    setAction(next)
    setRequestedVisibility(account.visibility)
    setEditAfterVisibility(false)
    setAcknowledged(false)
    apply.reset()
    preview.reset()
    preview.mutate()
  }

  function cancelDialog() {
    if (editSaving || apply.isPending) return
    if (action === 'visibility' && editAfterVisibility) {
      setAction('edit')
      setEditAfterVisibility(false)
      setAcknowledged(false)
      apply.reset()
      preview.reset()
      return
    }
    closeDialog()
  }

  async function saveAccountEdit(expectedVersion: number, selectedVisibility: FinanceVisibility) {
    setEditSaving(true)
    setEditError('')
    try {
      await onSaveAccount(account, {
        expected_version: expectedVersion,
        name: editAccountName.trim(),
        account_type: editAccountType,
        target_amount: editTargetAmount.trim() || null,
        visibility: selectedVisibility,
      })
      closeDialog()
    } catch (error) {
      setEditError(messageForError(error))
      if (error instanceof FinanceVersionConflictError && error.current_version !== null) {
        setEditExpectedVersion(error.current_version)
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const mayChangeVisibility = account.parent_id === null && account.owner_user_id === userId
    const selectedVisibility = mayChangeVisibility ? editVisibility : account.visibility
    if (selectedVisibility !== account.visibility) {
      setRequestedVisibility(selectedVisibility)
      setAcknowledged(false)
      setEditError('')
      setEditAfterVisibility(true)
      setAction('visibility')
      apply.reset()
      preview.reset()
      preview.mutate()
      return
    }
    await saveAccountEdit(editExpectedVersion, selectedVisibility)
  }

  async function submitLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || action === 'edit' || !preview.data) return
    const submittedAction = action
    try {
      const result = await apply.mutateAsync({
        account_id: account.id,
        expected_version: preview.data.version,
        snapshot_token: preview.data.snapshot_token,
        action: submittedAction,
        display_balance: submittedAction === 'balance' ? balance : null,
        visibility: submittedAction === 'visibility' ? requestedVisibility : null,
      })
      if (submittedAction === 'visibility' && editAfterVisibility) {
        await refresh()
        setEditExpectedVersion(result.version)
        setEditVisibility(requestedVisibility)
        setEditAfterVisibility(false)
        setAction('edit')
        await saveAccountEdit(result.version, requestedVisibility)
      } else {
        closeDialog()
        await refresh()
      }
    } catch (error) {
      if (error instanceof FinanceVersionConflictError) {
        requests.current.clear()
        preview.reset()
        await refresh()
      }
    }
  }

  const data = preview.data
  const visibilityBlocked = action === 'visibility' && (!data?.can_change_visibility || (requestedVisibility !== data?.visibility && Boolean(data?.external_transfer_count)))
  const restoreBlocked = action === 'restore' && data?.ancestor_archived
  const balanceBlocked = action === 'balance' && (data?.is_archived || data?.ancestor_archived)
  const title = action === 'edit' ? 'Edycja konta' : action ? `${actionNames[action]} · ${account.name}` : ''
  const titleId = `finance-account-dialog-title-${account.id}`
  const busy = editSaving || apply.isPending
  const swipeDialogRef = useMobileDialogSwipeDismiss(dialogRef, cancelDialog, !busy)

  return <>
    <div className="finance-savings-account-actions">
      {!inactive && <>
        <button type="button" className="button-quiet finance-edit-button finance-budget-edit-button finance-account-action-icon" onClick={startEdit} disabled={busy} aria-label={`Edytuj konto: ${account.name}`} title={`Edytuj konto: ${account.name}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
        </button>
        <button type="button" className="button-quiet finance-edit-button finance-budget-edit-button finance-account-action-icon finance-account-archive-icon" onClick={() => startLifecycle('archive')} disabled={busy} aria-label={`Archiwizuj konto: ${account.name}`} title={`Archiwizuj konto: ${account.name}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3 21 21" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-3 3.8" /><path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3.3-.5" /></svg>
        </button>
        <button type="button" className="button-quiet finance-edit-button finance-budget-edit-button finance-account-action-icon" onClick={() => startLifecycle('balance')} disabled={busy} aria-label={`Skoryguj saldo: ${account.name}`} title={`Skoryguj saldo: ${account.name}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M17 15h.01" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </>}
      {inactive && <button type="button" className="button-quiet finance-edit-button finance-budget-edit-button finance-account-action-icon" onClick={() => startLifecycle('restore')} disabled={busy} aria-label={`Przywróć konto: ${account.name}`} title={`Przywróć konto: ${account.name}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
      </button>}
    </div>
    <dialog
      ref={swipeDialogRef}
      className="finance-account-dialog"
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault()
        cancelDialog()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) cancelDialog()
      }}
    >
      {action === 'edit' && <form className="finance-account-dialog-form" onSubmit={event => void submitEdit(event)}>
        <header className="finance-account-dialog-header">
          <button className="button-quiet finance-account-dialog-close" type="button" aria-label="Zamknij edycję konta" onClick={closeDialog} disabled={busy}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <h2 id={titleId}>{title}</h2>
          <span aria-hidden="true" />
        </header>
        <div className="finance-account-dialog-body">
          <label>Nazwa<input required maxLength={160} value={editAccountName} onChange={event => setEditAccountName(event.target.value)} disabled={busy} /></label>
          <label>Typ
            <select value={editAccountType} onChange={event => setEditAccountType(event.target.value as FinanceSavingsAccountType)} disabled={busy}>
              <option value="cash">Gotówka</option>
              <option value="goal">Cel</option>
              <option value="investment">Inwestycje</option>
              <option value="retirement">Emerytura</option>
            </select>
          </label>
          <label>Cel<input inputMode="decimal" value={editTargetAmount} onChange={event => setEditTargetAmount(event.target.value)} placeholder="Brak celu" disabled={busy} /></label>
          {account.parent_id === null && account.owner_user_id === userId && <label>Zakres
            <select value={editVisibility} onChange={event => setEditVisibility(event.target.value as FinanceVisibility)} disabled={busy}>
              <option value="private">Prywatne</option>
              <option value="household">Domowe</option>
            </select>
          </label>}
          {editError && <p className="error-message finance-error" role="alert">{editError}</p>}
        </div>
        <footer className="finance-account-dialog-actions">
          <button className="button-quiet" type="button" onClick={closeDialog} disabled={busy}>Anuluj</button>
          <button className="primary-button" type="submit" disabled={busy}>{editSaving ? 'Zapisuję…' : 'Zapisz konto'}</button>
        </footer>
      </form>}
      {action && action !== 'edit' && <form className="finance-account-dialog-form" onSubmit={event => void submitLifecycle(event)}>
        <header className="finance-account-dialog-header">
          <button className="button-quiet finance-account-dialog-close" type="button" aria-label="Zamknij okno konta" onClick={cancelDialog} disabled={busy}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <h2 id={titleId}>{title}</h2>
          <span aria-hidden="true" />
        </header>
        <div className="finance-account-dialog-body">
          {preview.isPending && <p role="status">Ładuję podgląd…</p>}
          {preview.isError && <p className="error-message finance-error" role="alert">{preview.error.message}</p>}
          {data && <>
            {action === 'archive' && <p>Archiwizacja wyłączy konto i jego podkonta ({data.account_count}) z aktywnych sald oraz nowych transakcji. Historia pozostanie zachowana.</p>}
            {action === 'restore' && <p>Przywrócenie włączy konto i podkonta, które nie zostały zarchiwizowane osobno.</p>}
            {restoreBlocked && <p className="finance-error" role="alert">Najpierw przywróć zarchiwizowane konto nadrzędne.</p>}
            {action === 'balance' && <>
              <p>Saldo łączne z aktywnymi podkontami: {formatPln(financeMinorUnitsToMoney(data.display_balance_minor))}. Suma podkont: {formatPln(financeMinorUnitsToMoney(data.active_children_balance_minor))}.</p>
              <p>Korekta zmieni saldo początkowe tego konta. Zachowa historię transakcji i nie zwiększy miesięcznych oszczędności.</p>
              <label className="finance-account-dialog-full">Nowe saldo łączne z aktywnymi podkontami<input required inputMode="decimal" value={balance} onChange={event => setBalance(event.target.value)} disabled={busy} /></label>
              {balanceBlocked && <p className="finance-error" role="alert">Przywróć konto i jego przodków przed korektą.</p>}
            </>}
            {action === 'visibility' && <>
              <p>{requestedVisibility === 'household'
                ? 'To konto, jego podkonta oraz powiązana historia, salda, cele i szablony planów staną się dostępne dla domowników.'
                : 'To konto, jego podkonta oraz powiązana historia, salda, cele i szablony planów będą dostępne tylko dla właściciela. Domownicy utracą do nich dostęp.'}</p>
              <p>Zakres zostanie ustawiony na: <strong>{requestedVisibility === 'household' ? 'Domowe' : 'Prywatne'}</strong>.</p>
              <p>Zmiana obejmie {data.account_count} kont i {data.linked_plan_count} powiązanych planów.</p>
              {data.external_transfer_count > 0 && <p className="finance-error" role="alert">Przelewy do kont spoza tej grupy kont blokują zmianę widoczności. Liczba powiązań: {data.external_transfer_count}.</p>}
              <label className="finance-checkbox-label finance-account-dialog-full"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} /> Rozumiem wpływ zmiany na dostęp do całej historii.</label>
            </>}
          </>}
          {apply.isError && <p className="error-message finance-error" role="alert">{apply.error instanceof FinanceVersionConflictError
            ? 'Konto, historia lub podkonta zmieniły się. Załaduj nowy podgląd i sprawdź go przed zapisem.' : apply.error.message}</p>}
          {!data && !preview.isPending && <button className="button-quiet finance-account-dialog-full" type="button" onClick={() => preview.mutate()}>Odśwież podgląd</button>}
        </div>
        <footer className="finance-account-dialog-actions">
          <button className="button-quiet" type="button" onClick={cancelDialog} disabled={busy}>{action === 'visibility' && editAfterVisibility ? 'Wróć do edycji' : 'Anuluj'}</button>
          <button className="primary-button" type="submit" disabled={!data || busy || visibilityBlocked || Boolean(restoreBlocked) || Boolean(balanceBlocked) || (action === 'visibility' && !acknowledged)}>
            {apply.isPending ? 'Zapisuję…' : actionNames[action]}
          </button>
        </footer>
      </form>}
    </dialog>
  </>
}
