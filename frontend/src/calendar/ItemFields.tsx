import type { Visibility } from './types'

export function AddItemButton({ label, onClick, expanded, disabled = false }: { label: string; onClick: () => void; expanded: boolean; disabled?: boolean }) {
  return <button className="primary-button" type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-expanded={expanded}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    <span>{label}</span>
  </button>
}

export function ItemFields({ title, description, visibility, onTitle, onDescription, onVisibility, canChangeVisibility }: {
  title: string; description: string; visibility: Visibility
  onTitle: (value: string) => void; onDescription: (value: string) => void
  onVisibility: (value: Visibility) => void; canChangeVisibility: boolean
}) {
  return <>
    <label>Tytuł<input autoFocus required value={title} onChange={event => onTitle(event.target.value)} /></label>
    <label>Opis <span className="optional">(opcjonalnie)</span><textarea rows={3} value={description} onChange={event => onDescription(event.target.value)} /></label>
    <label>Widoczność<select disabled={!canChangeVisibility} value={visibility} onChange={event => onVisibility(event.target.value as Visibility)}>
      <option value="private">Prywatne · tylko Ty</option><option value="household">Wspólne · wszyscy domownicy</option>
    </select></label>
    <p className="task-meta">{canChangeVisibility ? 'Wspólne wpisy mogą edytować i usuwać wszyscy domownicy.' : 'Tylko autor może zmienić widoczność tego wpisu.'}</p>
  </>
}
