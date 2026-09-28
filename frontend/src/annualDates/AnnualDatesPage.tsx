import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { CalendarQueryState } from '../calendar/AgendaComponents'
import { refreshAnnualDateCaches } from '../calendar/cache'
import { formatDate, localDate } from '../calendar/dates'
import { AddItemButton } from '../calendar/ItemFields'
import { annualDatesKey } from '../calendar/queries'
import { AnnualDateForm } from './AnnualDateForm'
import { annualOccurrences, kindLabels, type AnnualDate, type AnnualDateInput } from './annualDates'
import { createAnnualDatesApi } from './api'

export function AnnualDatesPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const api = createAnnualDatesApi(profile.household_id, profile.id)
  const items = useQuery({ queryKey: annualDatesKey(profile.household_id, profile.id), queryFn: ({ signal }) => api.list(signal) })
  const [form, setForm] = useState<{ item: AnnualDate | null } | null>(null)
  const [deleting, setDeleting] = useState<AnnualDate | null>(null)
  const [notice, setNotice] = useState('')
  const save = useMutation({
    mutationFn: (input: AnnualDateInput) => form?.item ? api.update(form.item.id, input) : api.create(input),
    onSuccess: async saved => {
      setForm(null)
      setNotice('Ważna data zapisana.')
      await refreshAnnualDateCaches(client, profile.household_id, profile.id, saved)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: async id => {
      setDeleting(null)
      setNotice('Ważna data i jej coroczne wystąpienia zostały usunięte.')
      await refreshAnnualDateCaches(client, profile.household_id, profile.id, id)
    },
  })
  const busy = save.isPending || remove.isPending
  const today = localDate()
  const nextOccurrences = (items.data ?? []).map(item => {
    const start = item.kind !== 'other' && item.initialDate > today ? item.initialDate : today
    // Two calendar years include the next occurrence, including 29 February's
    // fallback. Future initial dates start their search at the definition date.
    const endYear = Math.min(Number(start.slice(0, 4)) + 2, 9999)
    const next = annualOccurrences([item], { start, end: `${endYear}-12-31` })[0]
    return { item, next }
  }).sort((a, b) => (a.next?.date ?? '9999').localeCompare(b.next?.date ?? '9999')
    || a.item.createdAt.localeCompare(b.item.createdAt) || a.item.id.localeCompare(b.item.id))

  function openForm(item: AnnualDate | null) {
    save.reset()
    remove.reset()
    setNotice('')
    setDeleting(null)
    setForm({ item })
  }

  return <>
    <PageHeader eyebrow="Co roku razem" title="Ważne daty" description="Urodziny, rocznice, imieniny i inne coroczne daty."
      action={<AddItemButton label="Dodaj ważną datę" expanded={!!form} disabled={busy} onClick={() => openForm(null)} />} />
    {notice && <p className="task-notice" role="status">{notice}</p>}
    {form && <AnnualDateForm key={form.item?.id ?? 'new'} item={form.item} userId={profile.id} pending={save.isPending} error={save.error?.message} onSave={input => save.mutate(input)} onCancel={() => setForm(null)} />}
    {deleting && <section className="panel empty-panel calendar-delete" aria-label="Potwierdź usunięcie ważnej daty">
      <p>Usunąć „{deleting.title}” i wszystkie jej coroczne wystąpienia?</p>
      <div className="form-actions"><button className="button-quiet" type="button" disabled={busy} onClick={() => remove.mutate(deleting.id)}>{remove.isPending ? 'Usuwam…' : 'Usuń ważną datę'}</button><button className="text-button" type="button" disabled={busy} onClick={() => setDeleting(null)}>Anuluj</button></div>
      {remove.isError && <p className="error-message" role="alert">{remove.error.message}</p>}
    </section>}
    <section className="panel" aria-labelledby="annual-dates-title">
      <div className="panel-head"><div><h2 className="panel-title" id="annual-dates-title">Coroczne daty</h2><p className="panel-kicker">Najbliższe wystąpienia. Prywatne daty widzisz tylko Ty.</p></div></div>
      <CalendarQueryState label="ważne daty" pending={items.isPending} error={items.error} onRetry={() => void items.refetch()} />
      {items.data && (nextOccurrences.length ? <ul className="annual-date-list">
        {nextOccurrences.map(({ item, next }) => <li className="annual-date-row" key={item.id}>
          <div><h3>{item.title}</h3><p className="task-meta">{kindLabels[item.kind]} · {item.visibility === 'private' ? 'Prywatne' : 'Wspólne'}</p>
            <p>{item.kind === 'other' ? `${item.day}.${String(item.month).padStart(2, '0')} · co roku` : `Data początkowa: ${formatDate(item.initialDate)}`}</p>
            {next && <p className="task-meta">Najbliższe: {formatDate(next.date)}{next.count !== null ? ` · ${next.count}. ${item.kind === 'birthday' ? 'urodziny' : 'rocznica'}` : ''}</p>}
            {item.description && <p className="event-description">{item.description}</p>}
          </div>
          <div className="agenda-actions"><button className="text-button" type="button" disabled={busy} onClick={() => openForm(item)} aria-label={`Edytuj: ${item.title}`}>Edytuj</button><button className="text-button" type="button" disabled={busy} onClick={() => { setForm(null); remove.reset(); setNotice(''); setDeleting(item) }} aria-label={`Usuń: ${item.title}`}>Usuń</button></div>
        </li>)}
      </ul> : <p className="panel-message">Brak ważnych dat. Dodaj urodziny, rocznicę lub inną coroczną datę.</p>)}
    </section>
  </>
}
