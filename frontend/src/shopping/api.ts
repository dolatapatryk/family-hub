import type { ShoppingItem } from './shopping'

export function createShoppingApi(baseUrl: string, userId: string) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        ...options,
        headers: { 'X-User-Id': userId, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error('Could not reach Family Hub. Check your connection and try again.')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status}). Please try again.`)
    }
    return response.json() as Promise<T>
  }

  return {
    list: async (signal?: AbortSignal): Promise<ShoppingItem[]> => {
      // The default endpoint only returns incomplete items; fetch purchased items too.
      const [active, purchased] = await Promise.all([
        request<ShoppingItem[]>('/shopping-items?completed=false', { signal }),
        request<ShoppingItem[]>('/shopping-items?completed=true', { signal }),
      ])
      // Another household member may check an item off between the two reads.
      return [...new Map([...active, ...purchased].map(item => [item.id, item])).values()]
    },
    create: (input: { name: string; quantity: string | null; store?: string | null }) =>
      request<ShoppingItem>('/shopping-items', { method: 'POST', body: JSON.stringify(input) }),
    setCompleted: (id: string, completed: boolean) =>
      request<ShoppingItem>(`/shopping-items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ completed }) }),
  }
}
