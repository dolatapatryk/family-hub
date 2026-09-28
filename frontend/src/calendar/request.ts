import type { SupabaseClient } from '@supabase/supabase-js'

export function requireClient(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Brak konfiguracji Supabase. Sprawdź ustawienia Family Hub.')
  return client
}

export async function resolveCalendarRequest<T>(
  request: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<T> {
  try {
    const { data, error } = await request()
    if (error) {
      if (error.code === '42501') throw new Error('Nie masz uprawnień do zmiany tego wpisu.')
      if (error.code === 'PGRST116') throw new Error('Wpis został usunięty lub nie jest już dostępny. Odśwież listę.')
      if (error.code === '23514') throw new Error('Sprawdź tytuł, daty, zakres godzin i strefę czasową wpisu.')
      throw new Error(error.message)
    }
    if (data === null) throw new Error('Nie otrzymano odpowiedzi. Spróbuj ponownie.')
    return data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : ''
    if (!message || /failed to fetch|network|load failed/i.test(message)) {
      throw new Error('Nie udało się połączyć z Family Hub. Sprawdź połączenie i spróbuj ponownie.')
    }
    throw error
  }
}
