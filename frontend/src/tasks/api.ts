import type { Task } from './tasks'

export function createTasksApi(baseUrl: string, userId: string) {
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
    list: (signal?: AbortSignal) => request<Task[]>('/tasks', { signal }),
    create: (input: { title: string; dueDate: string | null }) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    assign: (id: string, assignedTo: string) => request<Task>(`/tasks/${encodeURIComponent(id)}/assign`, { method: 'POST', body: JSON.stringify({ assignedTo }) }),
    action: (id: string, action: 'complete' | 'reopen' | 'archive') => request<Task>(`/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  }
}
