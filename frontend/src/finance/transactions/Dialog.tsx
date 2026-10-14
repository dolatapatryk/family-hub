import { useEffect, useId, useRef, type ReactNode } from 'react'

export function TransactionDialog({ title, busy, dirty, onClose, children }: {
  title: string; busy: boolean; dirty: boolean; onClose: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  function close() {
    if (!busy && (!dirty || window.confirm('Odrzucić niezapisane zmiany?'))) onClose()
  }
  return <dialog ref={ref} className="transaction-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close() }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" className="button-quiet" aria-label="Zamknij okno" disabled={busy} onClick={close}>×</button></header>
    {children}
    <button type="button" className="button-quiet transaction-cancel" disabled={busy} onClick={close}>Anuluj</button>
  </dialog>
}

export function FieldError({ message, id }: { message?: string; id: string }) {
  return message ? <span className="error-message" id={id}>{message}</span> : null
}
