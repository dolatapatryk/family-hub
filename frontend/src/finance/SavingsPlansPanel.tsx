import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFinanceApi } from './api'
import { calculateIrregularMonthlyReserve, calculateSavingsPlanAnnualAmount, isSavingsAccountArchived } from './calculations'
import { financeMinorUnitsToMoney, formatPln, sumMoney, addMoney } from './money'
import { FinanceKpis } from './FinanceCharts'
import { financeActionError, useFinanceAction } from './useFinanceAction'
import type { FinanceSavingsPlan, FinanceSavingsAccount, FinanceSaveSavingsPlanInput, FinanceVisibility, FinanceSavingsPlanType, FinanceIrregularExpensePlan, FinanceSaveIrregularReserveInput } from './types'

const typeNames: Record<FinanceSavingsPlanType, string> = { cash: 'Gotówka', goal: 'Cel', investment: 'Inwestycje', retirement: 'Emerytura', irregular: 'Nieregularny' }
const scopeName = (scope: FinanceVisibility) => scope === 'household' ? 'Domowy' : 'Prywatny'
function PlanForm({ plan, accounts, userId, pending, onSave, onCancel }: {
  plan: FinanceSavingsPlan | null; accounts: FinanceSavingsAccount[]; userId: string; pending: boolean
  onSave: (input: Omit<FinanceSaveSavingsPlanInput, 'request_id'>) => void; onCancel: () => void
}) {
  const [name, setName] = useState(plan?.name ?? '')
  const [accountId, setAccountId] = useState(plan?.account_id ?? '')
  const [type, setType] = useState<FinanceSavingsPlanType>(plan?.plan_type ?? 'cash')
  const [visibility, setVisibility] = useState<FinanceVisibility>(plan?.visibility ?? 'private')
  const [monthly, setMonthly] = useState(plan ? financeMinorUnitsToMoney(plan.monthly_amount) : '')
  const [annual, setAnnual] = useState(plan?.annual_amount_override == null ? '' : financeMinorUnitsToMoney(plan.annual_amount_override))
  const account = accounts.find(a => a.id === accountId)
  const controlsScope = !plan || plan.owner_user_id === userId
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({ id: plan?.id, expected_version: plan?.version, name, plan_type: account?.account_type ?? type,
      account_id: accountId || null, monthly_amount: monthly, annual_amount_override: annual.trim() || null,
      visibility: account?.visibility ?? visibility })
  }
  return <form className="finance-management-form" onSubmit={submit}>
    <label>Nazwa planu<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} disabled={pending} /></label>
    <label>Konto<select value={accountId} onChange={e => setAccountId(e.target.value)} disabled={pending || !controlsScope}>
      <option value="">Brak powiązania</option>
      {accounts.map(a => <option value={a.id} key={a.id}>{a.name} · {scopeName(a.visibility)}{isSavingsAccountArchived(a, accounts) ? ' · archiwalne' : ''}</option>)}
    </select></label>
    <label>Typ<select value={account?.account_type ?? type} onChange={e => setType(e.target.value as FinanceSavingsPlanType)} disabled={pending || Boolean(accountId)}>
      {Object.entries(typeNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
    <label>Zakres<select value={account?.visibility ?? visibility} onChange={e => setVisibility(e.target.value as FinanceVisibility)} disabled={pending || Boolean(accountId) || !controlsScope}>
      <option value="private">Prywatny</option><option value="household">Domowy</option>
    </select></label>
    <label>Kwota miesięczna<input required inputMode="decimal" value={monthly} onChange={e => setMonthly(e.target.value)} disabled={pending} /></label>
    <label>Kwota roczna (opcjonalnie)<input inputMode="decimal" value={annual} onChange={e => setAnnual(e.target.value)} placeholder="Miesięczna × 12" disabled={pending} /></label>
    <p>Plan powiązany dziedziczy właściciela, typ i widoczność konta. Plan domowy udostępnia nazwę i kwoty domownikom. To zapisany szablon; rzeczywiste wpłaty powstają po akceptacji planu miesięcznego.</p>
    <div className="finance-edit-actions"><button className="primary-button" disabled={pending} type="submit">Zapisz plan</button><button className="button-quiet" disabled={pending} type="button" onClick={onCancel}>Anuluj</button></div>
  </form>
}

function ReserveForm({ reserve, pending, onSave, onCancel }: { reserve: FinanceIrregularExpensePlan | null; pending: boolean; onSave: (input: Omit<FinanceSaveIrregularReserveInput, 'request_id'>) => void; onCancel: () => void }) {
  const [name, setName] = useState(reserve?.name ?? '')
  const [annual, setAnnual] = useState(reserve ? financeMinorUnitsToMoney(reserve.annual_amount) : '')
  return <form className="finance-management-form" onSubmit={e => { e.preventDefault(); onSave({ id: reserve?.id, expected_version: reserve?.version, name, annual_amount: annual }) }}>
    <label>Nazwa rezerwy<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} disabled={pending} /></label>
    <label>Kwota roczna<input required inputMode="decimal" value={annual} onChange={e => setAnnual(e.target.value)} disabled={pending} /></label>
    <div className="finance-edit-actions"><button className="primary-button" type="submit" disabled={pending}>Zapisz rezerwę</button><button className="button-quiet" type="button" disabled={pending} onClick={onCancel}>Anuluj</button></div>
  </form>
}

export function SavingsPlansPanel({ api, householdId, userId }: {
  api: ReturnType<typeof createFinanceApi>; householdId: string; userId: string
}) {
  const [editingPlan, setEditingPlan] = useState<string | null>(null)
  const [editingReserve, setEditingReserve] = useState<string | null>(null)
  const plansKey = ['financeSavingsPlans', householdId, userId] as const
  const reservesKey = ['financeIrregularReserves', householdId] as const
  const plans = useQuery({ queryKey: plansKey, queryFn: ({ signal }) => api.listSavingsPlans(signal) })
  const accounts = useQuery({ queryKey: ['financeSavingsAccounts', householdId, userId], queryFn: ({ signal }) => api.listSavingsAccounts(signal) })
  const reserves = useQuery({ queryKey: reservesKey, queryFn: ({ signal }) => api.listIrregularReserves(signal) })
  const planList = plans.data ?? []
  const reserveList = reserves.data ?? []
  const savePlan = useFinanceAction((input: Omit<FinanceSaveSavingsPlanInput, 'request_id'>, request_id) => api.saveSavingsPlan({ ...input, request_id }), [plansKey], () => setEditingPlan(null), () => setEditingPlan(null))
  const deletePlan = useFinanceAction((plan: FinanceSavingsPlan, request_id) => api.deleteSavingsPlan({ request_id, id: plan.id, expected_version: plan.version }), [plansKey])
  const saveReserve = useFinanceAction((input: Omit<FinanceSaveIrregularReserveInput, 'request_id'>, request_id) => api.saveIrregularReserve({ ...input, request_id }), [reservesKey], () => setEditingReserve(null), () => setEditingReserve(null))
  const deleteReserve = useFinanceAction((reserve: FinanceIrregularExpensePlan, request_id) => api.deleteIrregularReserve({ request_id, id: reserve.id, expected_version: reserve.version }), [reservesKey])
  const errors = [plans.error, accounts.error, reserves.error, savePlan.error, deletePlan.error, saveReserve.error, deleteReserve.error].filter(Boolean)
  const monthly = sumMoney(planList.map(plan => financeMinorUnitsToMoney(plan.monthly_amount)))
  const annualReserve = sumMoney(reserveList.map(reserve => financeMinorUnitsToMoney(reserve.annual_amount)))
  const monthlyReserve = sumMoney(reserveList.map(reserve => calculateIrregularMonthlyReserve(reserve.annual_amount)))
  return <div className="finance-page-stack">
    {!plans.isPending && !reserves.isPending && !plans.isError && !reserves.isError && <FinanceKpis values={[
      { label: 'Idealny plan miesięczny', value: formatPln(monthly) },
      { label: 'Rezerwy rocznie', value: formatPln(annualReserve) },
      { label: 'Rezerwy miesięcznie', value: formatPln(monthlyReserve) },
      { label: 'Razem miesięcznie', value: formatPln(addMoney(monthly, monthlyReserve)) },
    ]} />}
    <div className="finance-reserves-layout">
    {errors.map((error, i) => <p className="error-message" role="alert" key={i}>{financeActionError(error)}</p>)}
    <section className="panel finance-management-panel">
      <div className="panel-head"><div><h2 className="panel-title">Idealne oszczędności</h2><p className="panel-kicker">Definicje planów są oddzielne od budżetu i rzeczywistych wpłat.</p></div><button className="primary-button" type="button" onClick={() => { savePlan.reset(); setEditingPlan('new') }} disabled={savePlan.isPending}>Dodaj plan</button></div>
      {plans.isPending && <p role="status">Ładuję plany…</p>}
      {editingPlan !== null && <PlanForm key={editingPlan} plan={planList.find(p => p.id === editingPlan) ?? null} accounts={accounts.data ?? []} userId={userId} pending={savePlan.isPending} onSave={input => savePlan.mutate(input)} onCancel={() => setEditingPlan(null)} />}
      {planList.length === 0 && !plans.isPending && <p>Brak dostępnych planów. Dodaj plan i powiąż go z kontem.</p>}
      {planList.map(plan => <div className="finance-management-row" key={plan.id}>
        <div><strong>{plan.name}</strong><p>{typeNames[plan.plan_type]} · {scopeName(plan.visibility)} · {accounts.data?.find(a => a.id === plan.account_id)?.name ?? 'Bez konta'}</p></div>
        <div>{formatPln(financeMinorUnitsToMoney(plan.monthly_amount))} / miesiąc<br />{formatPln(calculateSavingsPlanAnnualAmount(plan))} / rok</div>
        <div className="finance-edit-actions"><button className="button-quiet" type="button" disabled={savePlan.isPending || deletePlan.isPending} onClick={() => { savePlan.reset(); setEditingPlan(plan.id) }}>Edytuj</button><button className="button-quiet" type="button" disabled={savePlan.isPending || deletePlan.isPending} onClick={() => deletePlan.mutate(plan)}>Usuń</button></div>
      </div>)}
    </section>
    <section className="panel finance-management-panel">
      <div className="panel-head"><div><h2 className="panel-title">Wydatki nieregularne · domowe</h2><p className="panel-kicker">Miesięczna rezerwa to kwota roczna / 12, zaokrąglona w górę do grosza.</p></div><button className="primary-button" type="button" onClick={() => { saveReserve.reset(); setEditingReserve('new') }} disabled={saveReserve.isPending}>Dodaj rezerwę</button></div>
      {reserves.isPending && <p role="status">Ładuję rezerwy…</p>}
      {editingReserve !== null && <ReserveForm key={editingReserve} reserve={reserveList.find(r => r.id === editingReserve) ?? null} pending={saveReserve.isPending} onSave={input => saveReserve.mutate(input)} onCancel={() => setEditingReserve(null)} />}
      {reserveList.length === 0 && !reserves.isPending && <p>Brak rezerw nieregularnych.</p>}
      {reserveList.map(reserve => <div className="finance-management-row" key={reserve.id}><strong>{reserve.name}</strong><div>{formatPln(financeMinorUnitsToMoney(reserve.annual_amount))} / rok<br />{formatPln(calculateIrregularMonthlyReserve(reserve.annual_amount))} / miesiąc</div><div className="finance-edit-actions"><button className="button-quiet" type="button" disabled={saveReserve.isPending || deleteReserve.isPending} onClick={() => { saveReserve.reset(); setEditingReserve(reserve.id) }}>Edytuj</button><button className="button-quiet" type="button" disabled={saveReserve.isPending || deleteReserve.isPending} onClick={() => deleteReserve.mutate(reserve)}>Usuń</button></div></div>)}
      {!reserves.isPending && !reserves.isError && <p>Łącznie domowe: {formatPln(sumMoney(reserveList.map(r => financeMinorUnitsToMoney(r.annual_amount))))} rocznie · {formatPln(sumMoney(reserveList.map(r => calculateIrregularMonthlyReserve(r.annual_amount))))} miesięcznie. Rezerwy nie tworzą automatycznie pozycji budżetu.</p>}
    </section>
  </div></div>
}
