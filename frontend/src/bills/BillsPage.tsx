import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/ToastProvider'
import { createBillsApi } from './api'
import { amountInputToMinorUnits, formatBillAmount, formatBillDate, formatBillTimestamp, localDate, minorUnitsToAmountInput, type Bill } from './bills'
import type { SaveBillInput } from './api'

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

type BillFormValues = { title: string; nextDueOn: string; intervalMonths: 1 | 2; expectedAmount: string; currency: string }
const emptyForm = (): BillFormValues => ({ title: '', nextDueOn: localDate(), intervalMonths: 1, expectedAmount: '', currency: 'PLN' })

export function BillsPage() {
  const { profile } = useAuth()
  const showToast = useToast()
  const client = useQueryClient()
  const api = createBillsApi(profile.household_id)
  const billKey = ['bills', profile.household_id]
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [values, setValues] = useState<BillFormValues>(emptyForm)
  const bills = useQuery({ queryKey: billKey, queryFn: ({ signal }) => api.list(signal) })
  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: SaveBillInput }) => id ? api.update(id, input) : api.create(input),
    onSuccess: async (_saved, variables) => {
      showToast({ kind: 'success', title: variables.id ? 'Zapisano rachunek' : 'Dodano rachunek' })
      resetForm()
      await client.invalidateQueries({ queryKey: billKey })
    },
    onError: (error, variables) => showToast({ kind: 'error', title: 'Nie udało się zapisać rachunku', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => save.mutate(variables) } }),
  })

  function resetForm() {
    setFormOpen(false)
    setEditingId(null)
    setValues(emptyForm())
  }

  function openCreateForm() {
    save.reset()
    setEditingId(null)
    setValues(emptyForm())
    setFormOpen(open => !open)
  }

  function editBill(bill: Bill) {
    save.reset()
    setEditingId(bill.id)
    setValues({
      title: bill.title,
      nextDueOn: bill.nextDueOn,
      intervalMonths: bill.intervalMonths,
      expectedAmount: bill.expectedAmountMinor === null ? '' : minorUnitsToAmountInput(bill.expectedAmountMinor),
      currency: bill.currency,
    })
    setFormOpen(true)
    window.setTimeout(() => document.getElementById('bill-title')?.focus(), 0)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const expectedAmount = values.expectedAmount ? amountInputToMinorUnits(values.expectedAmount) : null
    if (!values.title.trim() || !values.nextDueOn || !/^[a-zA-Z]{3}$/.test(values.currency.trim()) || (values.expectedAmount !== '' && expectedAmount === null) || save.isPending) return
    save.mutate({
      id: editingId,
      input: {
        title: values.title.trim(),
        nextDueOn: values.nextDueOn,
        intervalMonths: values.intervalMonths,
        expectedAmountMinor: expectedAmount,
        currency: values.currency.trim().toUpperCase(),
      },
    })
  }

  const activeBills = bills.data?.filter(bill => bill.active) ?? []
  const pausedBills = bills.data?.filter(bill => !bill.active) ?? []

  return <>
    <PageHeader
      eyebrow="Wspólny plan"
      title="Rachunki"
      description="Pilnuj cykli opłat i sprawdzaj historię każdego rachunku."
      action={<button className="primary-button" type="button" aria-expanded={formOpen} aria-controls="bill-form" onClick={openCreateForm}><PlusIcon /><span>{formOpen ? 'Zamknij formularz' : 'Dodaj rachunek'}</span></button>}
    />

    <form id="bill-form" className="panel bill-form" hidden={!formOpen} onSubmit={submit}>
      <div className="panel-head"><div><h2 className="panel-title">{editingId ? 'Edytuj rachunek' : 'Dodaj rachunek'}</h2><p className="panel-kicker">Wybierz cykl miesięczny lub dwumiesięczny. Następny termin możesz zmienić, gdy otrzymasz fakturę.</p></div></div>
      <fieldset disabled={save.isPending}>
        <div className="bill-form-fields">
          <label>Rachunek<input id="bill-title" required maxLength={90} value={values.title} onChange={event => setValues(current => ({ ...current, title: event.target.value }))} placeholder="np. Internet" /></label>
          <label>Następny termin<input required type="date" value={values.nextDueOn} onChange={event => setValues(current => ({ ...current, nextDueOn: event.target.value }))} /></label>
          <label>Częstotliwość<select value={values.intervalMonths} onChange={event => setValues(current => ({ ...current, intervalMonths: event.target.value === '2' ? 2 : 1 }))}><option value="1">Co miesiąc</option><option value="2">Co 2 miesiące</option></select></label>
          <label>Szacowana kwota <span className="optional">(opcjonalnie)</span><input type="number" min="0.01" max="90071992547409.91" step="0.01" value={values.expectedAmount} onChange={event => setValues(current => ({ ...current, expectedAmount: event.target.value }))} placeholder="0,00" /></label>
          <label>Waluta<input required maxLength={3} minLength={3} pattern="[A-Za-z]{3}" value={values.currency} onChange={event => setValues(current => ({ ...current, currency: event.target.value }))} aria-describedby="bill-currency-help" /></label>
        </div>
        <p className="bill-form-help" id="bill-currency-help">Podaj trzyznakowy kod waluty, np. PLN lub EUR. Szacunek może się zmieniać; faktyczna kwota jest zapisywana osobno przy każdej płatności.</p>
        <div className="form-actions"><button className="primary-button" type="submit" disabled={!values.title.trim() || !values.nextDueOn || !/^[a-zA-Z]{3}$/.test(values.currency.trim()) || (values.expectedAmount !== '' && amountInputToMinorUnits(values.expectedAmount) === null)}>{save.isPending ? 'Zapisuję…' : editingId ? 'Zapisz zmiany' : 'Dodaj rachunek'}</button><button className="button-quiet" type="button" disabled={save.isPending} onClick={resetForm}>Anuluj</button></div>
      </fieldset>
    </form>

    <section className="bill-section" aria-labelledby="active-bills-title">
      <div className="bill-section-heading"><div><h2 id="active-bills-title">Aktywne rachunki</h2><p>{activeBills.length} aktywnych rachunków z cyklem miesięcznym lub dwumiesięcznym</p></div></div>
      {bills.isPending && <p className="panel-message" role="status">Ładuję rachunki…</p>}
      {bills.isError && <div className="error-message" role="alert"><p>{bills.error.message}</p><button className="button-quiet" type="button" disabled={bills.isFetching} onClick={() => void bills.refetch()}>Spróbuj ponownie</button></div>}
      {bills.data && activeBills.length === 0 && <div className="panel empty-panel"><h2>Nie ma jeszcze rachunków.</h2><p>Dodaj rachunek, aby zobaczyć następny termin i zachować historię płatności.</p></div>}
      {bills.data && activeBills.length > 0 && <ul className="bill-list">{activeBills.map(bill => <BillItem key={bill.id} bill={bill} api={api} householdId={profile.household_id} billKey={billKey} onEdit={editBill} />)}</ul>}
    </section>

    {pausedBills.length > 0 && <section className="bill-section paused-bills" aria-labelledby="paused-bills-title">
      <div className="bill-section-heading"><div><h2 id="paused-bills-title">Wstrzymane</h2><p>Historia płatności pozostaje dostępna.</p></div></div>
      <ul className="bill-list">{pausedBills.map(bill => <BillItem key={bill.id} bill={bill} api={api} householdId={profile.household_id} billKey={billKey} onEdit={editBill} />)}</ul>
    </section>}
  </>
}

function BillItem({ bill, api, householdId, billKey, onEdit }: {
  bill: Bill
  api: ReturnType<typeof createBillsApi>
  householdId: string
  billKey: readonly unknown[]
  onEdit: (bill: Bill) => void
}) {
  const client = useQueryClient()
  const showToast = useToast()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [skipConfirmationOpen, setSkipConfirmationOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [paidOn, setPaidOn] = useState(localDate())
  const [amount, setAmount] = useState(bill.expectedAmountMinor === null ? '' : minorUnitsToAmountInput(bill.expectedAmountMinor))
  const historyKey = ['billHistory', householdId, bill.id]
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => api.listHistory(bill.id, signal),
    enabled: historyOpen,
  })
  const payment = useMutation({
    mutationFn: () => {
      const amountInMinorUnits = amountInputToMinorUnits(amount)
      if (amountInMinorUnits === null) throw new Error('Podaj kwotę z maksymalnie dwoma miejscami po przecinku.')
      return api.recordPayment(bill.id, bill.nextDueOn, paidOn, amountInMinorUnits)
    },
    onSuccess: async () => {
      setPaymentOpen(false)
      setPaidOn(localDate())
      showToast({ kind: 'success', title: 'Zapisano płatność', description: bill.title })
      await client.invalidateQueries({ queryKey: billKey })
      await client.invalidateQueries({ queryKey: historyKey })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się zapisać płatności', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => payment.mutate() } }),
  })
  const skip = useMutation({
    mutationFn: () => api.skipCycle(bill.id, bill.nextDueOn),
    onSuccess: async () => {
      setSkipConfirmationOpen(false)
      showToast({ kind: 'success', title: 'Pominięto cykl', description: bill.title })
      await client.invalidateQueries({ queryKey: billKey })
      await client.invalidateQueries({ queryKey: historyKey })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się pominąć cyklu', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => skip.mutate() } }),
  })
  const activeChange = useMutation({
    mutationFn: () => api.setActive(bill.id, !bill.active),
    onSuccess: async () => {
      showToast({ kind: 'success', title: bill.active ? 'Wstrzymano rachunek' : 'Wznowiono rachunek', description: bill.title })
      await client.invalidateQueries({ queryKey: billKey })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się zmienić statusu rachunku', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => activeChange.mutate() } }),
  })
  const today = localDate()
  const isOverdue = bill.nextDueOn < today
  const isDueToday = bill.nextDueOn === today

  function openPaymentForm() {
    payment.reset()
    skip.reset()
    setSkipConfirmationOpen(false)
    setPaidOn(localDate())
    setAmount(bill.expectedAmountMinor === null ? '' : minorUnitsToAmountInput(bill.expectedAmountMinor))
    setPaymentOpen(open => !open)
  }

  function openSkipConfirmation() {
    skip.reset()
    payment.reset()
    setPaymentOpen(false)
    setSkipConfirmationOpen(open => !open)
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!paidOn || amountInputToMinorUnits(amount) === null || payment.isPending) return
    payment.mutate()
  }

  return <li className={`bill-card${bill.active ? '' : ' bill-card-paused'}`}>
    <div className="bill-card-top">
      <div className="bill-card-copy">
        <h3>{bill.title}</h3>
        <p className={isOverdue && bill.active ? 'bill-due-label bill-overdue' : 'bill-due-label'}>
          {bill.active && isOverdue ? 'Po terminie · ' : bill.active && isDueToday ? 'Termin dziś · ' : 'Następny termin · '}{formatBillDate(bill.nextDueOn)}
          {bill.active && <span> · {bill.intervalMonths === 2 ? 'co 2 miesiące' : 'co miesiąc'}</span>}
        </p>
        {bill.expectedAmountMinor !== null && <p className="bill-expected-amount">Szacunek na kolejny termin: {formatBillAmount(bill.expectedAmountMinor, bill.currency)}</p>}
      </div>
      <div className="bill-card-actions">
        {bill.active && <button className="primary-button bill-pay-button" type="button" aria-expanded={paymentOpen} onClick={openPaymentForm}>{paymentOpen ? 'Anuluj' : 'Zapisz płatność'}</button>}
        {bill.active && <button className="text-button" type="button" aria-expanded={skipConfirmationOpen} aria-controls={`bill-skip-confirm-${bill.id}`} disabled={skip.isPending} onClick={openSkipConfirmation}>{skipConfirmationOpen ? 'Anuluj pomijanie' : 'Pomiń cykl'}</button>}
        <button className="text-button" type="button" onClick={() => onEdit(bill)}>Edytuj</button>
        <button className="text-button" type="button" disabled={activeChange.isPending} onClick={() => activeChange.mutate()}>{activeChange.isPending ? 'Zapisuję…' : bill.active ? 'Wstrzymaj' : 'Wznów'}</button>
      </div>
    </div>

    {paymentOpen && <form className="bill-payment-form" onSubmit={submitPayment}>
      <p className="bill-payment-intro">Wpisz faktycznie zapłaconą kwotę za cykl z terminem {formatBillDate(bill.nextDueOn)}. Szacunek jest tylko podpowiedzią; zapisze się dopiero kwota potwierdzona poniżej.</p>
      <div className="bill-payment-fields">
        <label>Data zapłaty<input type="date" required value={paidOn} disabled={payment.isPending} onChange={event => setPaidOn(event.target.value)} /></label>
        <label>Faktycznie zapłacona kwota ({bill.currency})<input type="number" required min="0.01" max="90071992547409.91" step="0.01" value={amount} disabled={payment.isPending} onChange={event => setAmount(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={!paidOn || amountInputToMinorUnits(amount) === null || payment.isPending}>{payment.isPending ? 'Zapisuję…' : 'Zapisz płatność'}</button><button className="button-quiet" type="button" disabled={payment.isPending} onClick={() => setPaymentOpen(false)}>Anuluj</button></div>
    </form>}

    {skipConfirmationOpen && <div id={`bill-skip-confirm-${bill.id}`} className="bill-skip-confirm" role="group" aria-label="Potwierdzenie pominięcia cyklu">
      <p>Pominąć cykl z terminem {formatBillDate(bill.nextDueOn)}? Nie zostanie oznaczony jako opłacony. Następny termin to {formatBillDate(nextBillDate(bill))}.</p>
      <div className="form-actions"><button className="primary-button" type="button" disabled={skip.isPending} onClick={() => skip.mutate()}>{skip.isPending ? 'Pomijam…' : 'Potwierdź pominięcie'}</button><button className="button-quiet" type="button" disabled={skip.isPending} onClick={() => setSkipConfirmationOpen(false)}>Anuluj</button></div>
    </div>}

    <div className="bill-history-toggle">
      <button className="link-button" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}>{historyOpen ? 'Ukryj historię cykli' : 'Pokaż historię cykli'} <span className="arrow" aria-hidden="true">{historyOpen ? '⌃' : '⌄'}</span></button>
    </div>
    {historyOpen && <div className="bill-history">
      {history.isPending && <p className="panel-message" role="status">Ładuję historię…</p>}
      {history.isError && <p className="error-message" role="alert">Nie udało się pobrać historii: {history.error.message}</p>}
      {history.data?.length === 0 && <p className="bill-history-empty">Nie zapisano jeszcze płatności ani pominięć.</p>}
      {history.data && history.data.length > 0 && <ul className="bill-history-list">{history.data.map(entry => <li key={entry.id}>
        {entry.kind === 'paid'
          ? <><span><strong>Termin {formatBillDate(entry.dueOn)}</strong><small>Zapłacono {formatBillDate(entry.paidOn)}</small></span><strong>{formatBillAmount(entry.amountMinor, entry.currency)}</strong></>
          : <span><strong>Pominięto cykl · termin {formatBillDate(entry.dueOn)}</strong><small>Zapisano {formatBillTimestamp(entry.skippedAt)}</small></span>}
      </li>)}</ul>}
    </div>}
  </li>
}

function nextBillDate(bill: Bill) {
  const [year, month, day] = bill.nextDueOn.split('-').map(Number)
  const targetMonth = new Date(year, month - 1 + bill.intervalMonths, 1)
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
  return localDate(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(bill.dueDay, lastDay)))
}
