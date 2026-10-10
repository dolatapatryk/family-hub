import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export type ToastInput = {
  kind: ToastKind
  title: string
  description?: string
  durationMs?: number
  action?: { label: string; onClick: () => void }
}

type Toast = ToastInput & { id: number }

const ToastContext = createContext<(toast: ToastInput) => void>(() => {
  throw new Error('useToast must be used inside ToastProvider')
})

const defaultDuration: Record<ToastKind, number> = {
  success: 3_500,
  error: 8_000,
  info: 5_000,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const showToast = useCallback((input: ToastInput) => {
    const toast = { ...input, id: ++nextId.current, durationMs: input.durationMs ?? defaultDuration[input.kind] }
    setToasts(current => [...current.slice(-2), toast])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  return <ToastContext.Provider value={showToast}>
    {children}
    {toasts.length > 0 && <div className="toast-viewport" role="region" aria-label="Powiadomienia">
      {toasts.map(toast => <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />)}
    </div>}
  </ToastContext.Provider>
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const dismiss = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id])

  function runAction() {
    toast.action?.onClick()
    dismiss()
  }

  useEffect(() => {
    if (toast.durationMs === 0) return
    const timeout = window.setTimeout(dismiss, toast.durationMs)
    return () => window.clearTimeout(timeout)
  }, [dismiss, toast.durationMs])

  return <div className={`toast-card toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-atomic="true">
    <span className="toast-icon" aria-hidden="true">{toast.kind === 'error' ? '!' : toast.kind === 'success' ? '✓' : 'i'}</span>
    <div className="toast-copy">
      <p className="toast-title">{toast.title}</p>
      {toast.description && <p className="toast-description">{toast.description}</p>}
    </div>
    <button className="toast-dismiss" type="button" onClick={dismiss} aria-label="Zamknij powiadomienie">×</button>
    {toast.action && <button className="toast-action" type="button" onClick={runAction}>{toast.action.label}</button>}
  </div>
}

export function useToast() {
  return useContext(ToastContext)
}
