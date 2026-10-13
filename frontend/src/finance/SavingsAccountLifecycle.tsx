import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFinanceApi, FinanceVersionConflictError } from './api'
import { financeMinorUnitsToMoney, formatPln } from './money'
import type { FinanceAccountLifecycleAction, FinanceAccountLifecycleInput, FinanceSavingsAccount } from './types'
import { createUuid } from '../utils/uuid'

const actionNames: Record<FinanceAccountLifecycleAction, string> = {
  archive: 'Archiwizuj', restore: 'Przywróć', balance: 'Skoryguj saldo', visibility: 'Zmień widoczność',
}

export function SavingsAccountLifecycle({ api, account, userId, inactive }: {
  api: ReturnType<typeof createFinanceApi>
  account: FinanceSavingsAccount
  userId: string
  inactive: boolean
}) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<FinanceAccountLifecycleAction | null>(null)
  const [balance, setBalance] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const requests = useRef(new Map<string, string>())
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
    await api.applyAccountLifecycle({ ...input, request_id: requestId })
    requests.current.delete(signature)
  }, onSuccess: async () => {
    setAction(null)
    await refresh()
  }, onError: async error => {
    if (error instanceof FinanceVersionConflictError) {
      requests.current.clear()
      preview.reset()
      await refresh()
    }
  } })

  function refresh() {
    return Promise.all(['financeSavingsAccounts', 'financeSavingsTransactions', 'financeSavingsPlans', 'financeSavingsTransfers']
      .map(key => queryClient.invalidateQueries({ queryKey: [key, account.household_id] })))
  }

  function start(next: FinanceAccountLifecycleAction) {
    setAction(next)
    setAcknowledged(false)
    apply.reset()
    preview.reset()
    preview.mutate()
  }

  const data = preview.data
  const nextVisibility = data?.visibility === 'household' ? 'private' : 'household'
  const visibilityBlocked = action === 'visibility' && (!data?.can_change_visibility || data.external_transfer_count > 0)
  const restoreBlocked = action === 'restore' && data?.ancestor_archived
  const balanceBlocked = action === 'balance' && (data?.is_archived || data?.ancestor_archived)
  return (
    <div className="finance-account-lifecycle">
      <div className="finance-edit-actions">
        {account.is_archived
          ? <button type="button" className="button-quiet" onClick={() => start('restore')} disabled={apply.isPending || preview.isPending}>Przywróć</button>
          : <button type="button" className="button-quiet" onClick={() => start('archive')} disabled={apply.isPending || preview.isPending}>Archiwizuj</button>}
        {!inactive && <button type="button" className="button-quiet" onClick={() => start('balance')} disabled={apply.isPending || preview.isPending}>Skoryguj saldo</button>}
        {account.parent_id === null && account.owner_user_id === userId && (
          <button type="button" className="button-quiet" onClick={() => start('visibility')} disabled={apply.isPending || preview.isPending}>Zmień widoczność</button>
        )}
      </div>
      {action && (
        <form className="finance-savings-edit-form" aria-label={`${actionNames[action]} · ${account.name}`} onSubmit={event => {
          event.preventDefault()
          if (!data) return
          apply.mutate({ account_id: account.id, expected_version: data.version, snapshot_token: data.snapshot_token,
            action, display_balance: action === 'balance' ? balance : null,
            visibility: action === 'visibility' ? nextVisibility : null })
        }}>
          <h3 className="finance-subheading">{actionNames[action]} · {account.name}</h3>
          {preview.isPending && <p role="status">Ładuję podgląd…</p>}
          {preview.isError && <p className="error-message" role="alert">{String(preview.error.message)}</p>}
          {data && <>
            {action === 'archive' && <p>Archiwizacja wyłączy konto i jego podkonta ({data.account_count}) z aktywnych sald oraz nowych ruchów. Historia pozostanie zachowana.</p>}
            {action === 'restore' && <p>Przywrócenie włączy konto i podkonta, które nie zostały zarchiwizowane osobno.</p>}
            {restoreBlocked && <p role="alert">Najpierw przywróć zarchiwizowane konto nadrzędne.</p>}
            {action === 'balance' && <>
              <p>Aktualne saldo z aktywnymi podkontami: {formatPln(financeMinorUnitsToMoney(data.display_balance_minor))}. Podkonta: {formatPln(financeMinorUnitsToMoney(data.active_children_balance_minor))}.</p>
              <p>Korekta zmieni saldo początkowe tego konta. Zachowa historię ruchów i nie zwiększy miesięcznych oszczędności.</p>
              <label>Nowe saldo z aktywnymi podkontami<input required inputMode="decimal" value={balance} onChange={event => setBalance(event.target.value)} disabled={apply.isPending} /></label>
              {balanceBlocked && <p role="alert">Przywróć konto i jego przodków przed korektą.</p>}
            </>}
            {action === 'visibility' && <>
              <p>{nextVisibility === 'household'
                ? 'Całe drzewo kont oraz jego dotychczasowa historia, salda, cele i powiązane szablony planów staną się dostępne dla domowników.'
                : 'Całe drzewo kont oraz jego historia, salda, cele i powiązane szablony planów będą dostępne tylko dla właściciela. Domownicy utracą do nich dostęp.'}</p>
              <p>Zmiana obejmie {data.account_count} kont i {data.linked_plan_count} powiązanych planów.</p>
              {data.external_transfer_count > 0 && <p role="alert">Przelewy do kont poza tym drzewem blokują zmianę widoczności. Liczba powiązań: {data.external_transfer_count}.</p>}
              <label className="finance-checkbox-label"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={apply.isPending} /> Rozumiem wpływ zmiany na dostęp do całej historii.</label>
            </>}
          </>}
          {apply.isError && <p className="error-message" role="alert">{apply.error instanceof FinanceVersionConflictError
            ? 'Konto, historia lub podkonta zmieniły się. Załaduj nowy podgląd i sprawdź go przed zapisem.' : apply.error.message}</p>}
          {!data && !preview.isPending && <button className="button-quiet" type="button" onClick={() => preview.mutate()}>Odśwież podgląd</button>}
          <div className="finance-edit-actions">
            <button className="primary-button" type="submit" disabled={!data || apply.isPending || visibilityBlocked || Boolean(restoreBlocked) || Boolean(balanceBlocked) || (action === 'visibility' && !acknowledged)}> {apply.isPending ? 'Zapisuję…' : actionNames[action]}</button>
            <button className="button-quiet" type="button" onClick={() => setAction(null)} disabled={apply.isPending || preview.isPending}>Anuluj</button>
          </div>
        </form>
      )}
    </div>
  )
}
