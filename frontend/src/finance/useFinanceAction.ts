import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FinanceVersionConflictError } from './api'

/** Keep the request ID on transport failure; a reviewed conflict starts anew. */
export function useFinanceAction<T, R>(
  action: (input: T, requestId: string) => Promise<R>,
  keys: readonly (readonly unknown[])[],
  onSuccess?: (result: R, input: T) => void,
  onConflict?: () => void,
) {
  const requests = useRef(new Map<string, string>())
  const queryClient = useQueryClient()
  const refresh = () => Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })))
  return useMutation({
    mutationFn: async (input: T) => {
      const signature = JSON.stringify(input)
      let requestId = requests.current.get(signature)
      if (!requestId) {
        requestId = crypto.randomUUID()
        requests.current.set(signature, requestId)
      }
      const result = await action(input, requestId)
      requests.current.delete(signature)
      return result
    },
    onSuccess: async (result, input) => { onSuccess?.(result, input); await refresh() },
    onError: async (error, input) => {
      if (error instanceof FinanceVersionConflictError) {
        requests.current.delete(JSON.stringify(input))
        onConflict?.()
        await refresh()
      }
    },
  })
}

export function financeActionError(error: unknown) {
  return error instanceof FinanceVersionConflictError
    ? 'Dane zmieniły się. Odświeżono najnowszą wersję — sprawdź ją przed kolejnym zapisem.'
    : error instanceof Error ? error.message : 'Nie udało się zapisać zmian.'
}
