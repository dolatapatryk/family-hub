import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { canTransferBetweenSavingsAccounts } from './privacy'
import { getActiveSavingsAccounts } from './calculations'
import { FinanceVersionConflictError, createFinanceApi } from './api'
import { financeMinorUnitsToMoney, formatPln } from './money'
import { createUuid } from '../utils/uuid'
import type { FinanceSavingsTransferRecord } from './types'

function localDateToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function errorText(error: unknown) {
  if (error instanceof FinanceVersionConflictError) {
    return error.current_version === null
      ? 'To konto lub przelew nie jest już dostępny.'
      : 'Dane zmieniły się po ich załadowaniu. Odświeżono dostępne informacje — sprawdź je i spróbuj ponownie.'
  }
  return error instanceof Error ? error.message : 'Nie udało się zapisać przelewu.'
}

function accountAudienceLabel(visibility: 'household' | 'private') {
  return visibility === 'household' ? 'Domowe' : 'Prywatne'
}

export function SavingsTransfersPanel({
  api,
  householdId,
  userId,
}: {
  api: ReturnType<typeof createFinanceApi>
  householdId: string
  userId: string
}) {
  const queryClient = useQueryClient()
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(localDateToday)
  const [description, setDescription] = useState('')
  const createRequests = useRef(new Map<string, {
    requestId: string
    fromExpectedVersion: number
    toExpectedVersion: number
  }>())
  const deleteRequests = useRef(new Map<string, string>())

  const accountsKey = ['financeSavingsAccounts', householdId, userId] as const
  const transfersKey = ['financeSavingsTransfers', householdId, userId] as const
  const accounts = useQuery({
    queryKey: accountsKey,
    queryFn: ({ signal }) => api.listSavingsAccounts(signal),
  })
  const transfers = useQuery({
    queryKey: transfersKey,
    queryFn: ({ signal }) => api.listSavingsTransfers(signal),
  })

  const accountList = accounts.data ?? []
  const availableAccounts = useMemo(() => getActiveSavingsAccounts(accountList), [accountList])
  const selectedFromAccount = availableAccounts.find(account => account.id === fromAccountId)
  const eligibleDestinationAccounts = selectedFromAccount
    ? availableAccounts.filter(account => account.id !== selectedFromAccount.id
      && canTransferBetweenSavingsAccounts(selectedFromAccount, account))
    : []
  const selectedToAccount = eligibleDestinationAccounts.find(account => account.id === toAccountId)

  useEffect(() => {
    if (!availableAccounts.some(account => account.id === fromAccountId)) {
      setFromAccountId(availableAccounts[0]?.id ?? '')
    }
  }, [availableAccounts, fromAccountId])

  useEffect(() => {
    if (!eligibleDestinationAccounts.some(account => account.id === toAccountId)) {
      setToAccountId(eligibleDestinationAccounts[0]?.id ?? '')
    }
  }, [eligibleDestinationAccounts, toAccountId])

  const createTransfer = useMutation({
    mutationFn: async (signature: string) => {
      if (!selectedFromAccount || !selectedToAccount) throw new Error('Wybierz dostępne konta do przelewu.')
      const currentSignature = JSON.stringify({
        from: selectedFromAccount.id,
        to: selectedToAccount.id,
        amount,
        date,
        description: description.trim() || null,
      })
      if (currentSignature !== signature) throw new Error('Sprawdź ponownie dane przelewu przed zapisaniem.')
      let request = createRequests.current.get(signature)
      if (!request) {
        request = {
          requestId: createUuid(),
          fromExpectedVersion: selectedFromAccount.version,
          toExpectedVersion: selectedToAccount.version,
        }
        createRequests.current.set(signature, request)
      }
      await api.createSavingsTransfer({
        request_id: request.requestId,
        from_account_id: selectedFromAccount.id,
        from_expected_version: request.fromExpectedVersion,
        to_account_id: selectedToAccount.id,
        to_expected_version: request.toExpectedVersion,
        amount,
        transaction_date: date,
        description: description.trim() || null,
      })
      return signature
    },
    onSuccess: async signature => {
      createRequests.current.delete(signature)
      setAmount('')
      setDescription('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsKey }),
        queryClient.invalidateQueries({ queryKey: transfersKey }),
      ])
    },
    onError: async (error, signature) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      createRequests.current.delete(signature)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsKey }),
        queryClient.invalidateQueries({ queryKey: transfersKey }),
      ])
    },
  })

  const deleteTransfer = useMutation({
    mutationFn: async (transfer: FinanceSavingsTransferRecord) => {
      const requestKey = `${transfer.id}:${transfer.version}`
      let requestId = deleteRequests.current.get(requestKey)
      if (!requestId) {
        requestId = createUuid()
        deleteRequests.current.set(requestKey, requestId)
      }
      await api.deleteSavingsTransfer({
        request_id: requestId,
        transfer_id: transfer.id,
        expected_version: transfer.version,
      })
      return requestKey
    },
    onSuccess: async requestKey => {
      deleteRequests.current.delete(requestKey)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsKey }),
        queryClient.invalidateQueries({ queryKey: transfersKey }),
      ])
    },
    onError: async error => {
      if (!(error instanceof FinanceVersionConflictError)) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountsKey }),
        queryClient.invalidateQueries({ queryKey: transfersKey }),
      ])
    },
  })

  function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedFromAccount || !selectedToAccount) return
    createTransfer.mutate(JSON.stringify({
      from: selectedFromAccount.id,
      to: selectedToAccount.id,
      amount,
      date,
      description: description.trim() || null,
    }))
  }

  const accountById = new Map(accountList.map(account => [account.id, account]))

  return (
    <section className="panel finance-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Przelewy między kontami</h2>
          <p className="panel-kicker">Przelewy wymagają zgodnego zakresu prywatności i nie zwiększają miesięcznych oszczędności.</p>
        </div>
      </div>

      {accounts.isPending && <p className="panel-message" role="status">Ładuję dostępne konta…</p>}
      {accounts.isError && <p className="error-message finance-error" role="alert">{errorText(accounts.error)}</p>}
      {!accounts.isPending && availableAccounts.length === 0 && (
        <p className="panel-message">Nie ma jeszcze aktywnych kont oszczędnościowych dostępnych do przelewu.</p>
      )}

      {availableAccounts.length > 0 && (
        <form className="finance-transfer-form" onSubmit={submitTransfer}>
          <label>Z konta
            <select required value={fromAccountId} onChange={event => setFromAccountId(event.target.value)} disabled={createTransfer.isPending}>
              {availableAccounts.map(account => (
                <option value={account.id} key={account.id}>
                  {account.name} · {accountAudienceLabel(account.visibility)}
                </option>
              ))}
            </select>
          </label>
          <label>Na konto
            <select required value={toAccountId} onChange={event => setToAccountId(event.target.value)} disabled={!eligibleDestinationAccounts.length || createTransfer.isPending}>
              {eligibleDestinationAccounts.map(account => (
                <option value={account.id} key={account.id}>
                  {account.name} · {accountAudienceLabel(account.visibility)}
                </option>
              ))}
            </select>
          </label>
          <label>Kwota
            <input required min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" disabled={createTransfer.isPending} />
          </label>
          <label>Data
            <input required type="date" value={date} onChange={event => setDate(event.target.value)} disabled={createTransfer.isPending} />
          </label>
          <label className="finance-transfer-description">Opis
            <input maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Opcjonalny opis" disabled={createTransfer.isPending} />
          </label>
          <button className="primary-button" type="submit" disabled={!selectedFromAccount || !selectedToAccount || createTransfer.isPending}>
            {createTransfer.isPending ? 'Zapisuję przelew…' : 'Dodaj przelew'}
          </button>
        </form>
      )}

      {createTransfer.isError && <p className="error-message finance-error" role="alert">{errorText(createTransfer.error)}</p>}

      <div className="finance-transfer-history">
        <h3 className="finance-subheading">Historia przelewów</h3>
        {transfers.isPending && <p className="panel-message" role="status">Ładuję historię…</p>}
        {transfers.isError && <p className="error-message finance-error" role="alert">{errorText(transfers.error)}</p>}
        {transfers.data?.length === 0 && <p className="panel-message">Nie ma jeszcze przelewów dostępnych w tym widoku.</p>}
        {(transfers.data ?? []).map(transfer => {
          const from = accountById.get(transfer.from_account_id)
          const to = accountById.get(transfer.to_account_id)
          return (
            <div className="finance-transfer-row" key={transfer.id}>
              <div className="finance-transfer-copy">
                <strong>{from?.name ?? 'Konto'} → {to?.name ?? 'Konto'}</strong>
                <span>{transfer.transaction_date}{transfer.description ? ` · ${transfer.description}` : ''}</span>
              </div>
              <strong>{formatPln(financeMinorUnitsToMoney(transfer.amount))}</strong>
              <button
                className="button-quiet finance-edit-button"
                type="button"
                onClick={() => deleteTransfer.mutate(transfer)}
                disabled={deleteTransfer.isPending}
                aria-label={`Usuń przelew ${from?.name ?? ''} do ${to?.name ?? ''}`}
              >
                Usuń
              </button>
            </div>
          )
        })}
        {deleteTransfer.isError && <p className="error-message finance-error" role="alert">{errorText(deleteTransfer.error)}</p>}
      </div>
    </section>
  )
}
