import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FinanceVersionConflictError } from '../api'
import { createUuid } from '../../utils/uuid'

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return online
}
export function useTransactionAction(queryKey: readonly string[]) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const locked = useRef(false)
  const requests = useRef(new Map<string, string>())
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  async function run<T>(payload: unknown, action: (requestId: string) => Promise<T>, onSuccess: (result: T) => void) {
    if (locked.current || conflict) return
    if (!navigator.onLine) { setError('Brak połączenia. Dane formularza zachowano. Spróbuj ponownie po połączeniu.'); return }
    locked.current = true; setBusy(true); setError('')
    const signature = JSON.stringify(payload)
    const requestId = requests.current.get(signature) ?? createUuid()
    requests.current.set(signature, requestId)
    try {
      const result = await action(requestId)
      requests.current.delete(signature)
      await client.invalidateQueries({ queryKey })
      onSuccess(result)
    } catch (failure) {
      if (failure instanceof FinanceVersionConflictError) {
        requests.current.delete(signature); setConflict(true)
        setError('Dane zmieniły się lub nie są już dostępne. Zachowano Twój formularz. Zamknij go i otwórz ponownie, aby sprawdzić najnowszą wersję przed zapisem.')
        void client.invalidateQueries({ queryKey })
      } else setError(failure instanceof Error ? `Nie udało się zapisać. ${failure.message}` : 'Nie udało się zapisać. Spróbuj ponownie.')
    } finally { locked.current = false; setBusy(false) }
  }
  return { run, busy, error, conflict, errorRef }
}
