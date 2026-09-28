import { useState, type FormEvent } from 'react'
import { daysInMonth, validDate } from '../calendar/dates'
import { ItemFields } from '../calendar/ItemFields'
import type { Visibility } from '../calendar/types'
import { kindLabels, type AnnualDate, type AnnualDateInput } from './annualDates'

export function AnnualDateForm({ item, userId, pending, error, onSave, onCancel }: {
  item: AnnualDate | null; userId: string; pending: boolean; error: string | undefined
  onSave: (input: AnnualDateInput) => void; onCancel: () => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [visibility, setVisibility] = useState<Visibility>(item?.visibility ?? 'private')
  const [kind, setKind] = useState<AnnualDate['kind']>(item?.kind ?? 'birthday')
  const [initialDate, setInitialDate] = useState(item && item.kind !== 'other' ? item.initialDate : '')
  const [month, setMonth] = useState(item?.kind === 'other' ? item.month : 1)
  const [day, setDay] = useState(item?.kind === 'other' ? item.day : 1)
  const [validation, setValidation] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!title.trim()) { setValidation('Podaj tytuł.'); return }
    if (kind !== 'other' && !validDate(initialDate)) { setValidation('Podaj pełną datę, razem z rokiem.'); return }
    if (kind === 'other' && (day < 1 || day > daysInMonth(month))) { setValidation('Podaj poprawny dzień i miesiąc.'); return }
    setValidation('')
    const common = { title: title.trim(), description: description.trim() || null, visibility }
    onSave(kind === 'other' ? { ...common, kind, month, day } : { ...common, kind, initialDate })
  }

  return <form className="panel task-form calendar-form" onSubmit={submit} aria-label={item ? 'Edytuj ważną datę' : 'Dodaj ważną datę'}>
    <div className="panel-head"><div><h2 className="panel-title">{item ? 'Edytuj ważną datę' : 'Dodaj ważną datę'}</h2><p className="panel-kicker">Jedna definicja, przypomnienie każdego roku.</p></div></div>
    <fieldset disabled={pending}>
      <ItemFields title={title} description={description} visibility={visibility} onTitle={setTitle} onDescription={setDescription} onVisibility={setVisibility} canChangeVisibility={!item || item.createdBy === userId} />
      <label>Rodzaj<select value={kind} onChange={event => setKind(event.target.value as AnnualDate['kind'])}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {kind === 'other' ? <div className="task-form-options">
        <label>Miesiąc<select value={month} onChange={event => { const next = Number(event.target.value); setMonth(next); setDay(current => Math.min(current, daysInMonth(next))) }}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index}>{new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(2000, index, 1))}</option>)}</select></label>
        <label>Dzień<select value={day} onChange={event => setDay(Number(event.target.value))}>{Array.from({ length: daysInMonth(month) }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
      </div> : <label>{kind === 'birthday' ? 'Data urodzenia' : 'Data początkowa rocznicy'}<input type="date" required min="0001-01-01" max="9999-12-31" value={initialDate} onChange={event => setInitialDate(event.target.value)} /></label>}
      <p className="task-meta">{kind === 'other' ? 'Bez roku i bez numeru rocznicy.' : 'Pierwsza rocznica pojawi się rok po dacie początkowej.'} 29 lutego przypada na 28 lutego w latach nieprzestępnych.</p>
      {(validation || error) && <p className="error-message" role="alert">{validation || error}</p>}
      <div className="form-actions"><button className="primary-button" type="submit">{pending ? 'Zapisuję…' : 'Zapisz datę'}</button><button className="text-button" type="button" onClick={onCancel}>Anuluj</button></div>
    </fieldset>
  </form>
}
