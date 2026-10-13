import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFinanceApi } from './api'
import { calculateProjectTotals } from './calculations'
import { financeMinorUnitsToMoney, formatPln, moneyRatio } from './money'
import { financeActionError, useFinanceAction } from './useFinanceAction'
import type { FinanceProject, FinanceProjectExpense, FinanceSaveProjectInput, FinanceSaveProjectExpenseInput } from './types'

function ProjectForm({ project, pending, onSave, onCancel }: { project: FinanceProject | null; pending: boolean; onSave: (input: Omit<FinanceSaveProjectInput, 'request_id'>) => void; onCancel: () => void }) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [target, setTarget] = useState(project?.target_budget == null ? '' : financeMinorUnitsToMoney(project.target_budget))
  return <form className="finance-management-form" onSubmit={e => { e.preventDefault(); onSave({ id: project?.id, expected_version: project?.version, name, description: description.trim() || null, target_budget: target.trim() || null, is_archived: project?.is_archived ?? false }) }}>
    <label>Nazwa projektu<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} disabled={pending} /></label>
    <label>Budżet docelowy (opcjonalnie)<input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} disabled={pending} /></label>
    <label>Opis<input maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} disabled={pending} /></label>
    <div className="finance-edit-actions"><button className="primary-button" type="submit" disabled={pending}>Zapisz projekt</button><button className="button-quiet" type="button" onClick={onCancel} disabled={pending}>Anuluj</button></div>
  </form>
}

function ExpenseForm({ expense, projectId, pending, onSave, onCancel }: { expense: FinanceProjectExpense | null; projectId: string; pending: boolean; onSave: (input: Omit<FinanceSaveProjectExpenseInput, 'request_id'>) => void; onCancel: () => void }) {
  const [name, setName] = useState(expense?.name ?? '')
  const [amount, setAmount] = useState(expense ? financeMinorUnitsToMoney(expense.amount) : '')
  const [date, setDate] = useState(expense?.expense_date ?? '')
  const [notes, setNotes] = useState(expense?.notes ?? '')
  return <form className="finance-management-form" onSubmit={e => { e.preventDefault(); onSave({ id: expense?.id, expected_version: expense?.version, project_id: projectId, expense_date: date || null, name, amount, notes: notes.trim() || null }) }}>
    <label>Nazwa wydatku<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} disabled={pending} /></label>
    <label>Kwota (ujemna dla zwrotu)<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={pending} /></label>
    <label>Data (opcjonalnie)<input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={pending} /></label>
    <label>Notatki<input maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} disabled={pending} /></label>
    <div className="finance-edit-actions"><button className="primary-button" type="submit" disabled={pending}>Zapisz wydatek</button><button className="button-quiet" type="button" onClick={onCancel} disabled={pending}>Anuluj</button></div>
  </form>
}

export function ProjectsPanel({ api, householdId }: { api: ReturnType<typeof createFinanceApi>; householdId: string }) {
  const [selectedId, setSelectedId] = useState('')
  const [editingProject, setEditingProject] = useState<string | null>(null)
  const [editingExpense, setEditingExpense] = useState<string | null>(null)
  const projectsKey = ['financeProjects', householdId] as const
  const expensesKey = ['financeProjectExpenses', householdId] as const
  const projects = useQuery({ queryKey: projectsKey, queryFn: ({ signal }) => api.listProjects(signal) })
  const expenses = useQuery({ queryKey: expensesKey, queryFn: ({ signal }) => api.listProjectExpenses(signal) })
  const projectList = projects.data ?? []
  const expenseList = expenses.data ?? []
  const saveProject = useFinanceAction((input: Omit<FinanceSaveProjectInput, 'request_id'>, request_id) => api.saveProject({ ...input, request_id }), [projectsKey], () => setEditingProject(null), () => setEditingProject(null))
  const deleteProject = useFinanceAction((project: FinanceProject, request_id) => api.deleteProject({ request_id, id: project.id, expected_version: project.version }), [projectsKey])
  const saveExpense = useFinanceAction((input: Omit<FinanceSaveProjectExpenseInput, 'request_id'>, request_id) => api.saveProjectExpense({ ...input, request_id }), [expensesKey], () => setEditingExpense(null), () => setEditingExpense(null))
  const deleteExpense = useFinanceAction((expense: FinanceProjectExpense, request_id) => api.deleteProjectExpense({ request_id, id: expense.id, expected_version: expense.version }), [expensesKey])
  const errors = [projects.error, expenses.error, saveProject.error, deleteProject.error, saveExpense.error, deleteExpense.error].filter(Boolean)
  return <div className="finance-page-stack">
    {errors.map((error, i) => <p className="error-message" role="alert" key={i}>{financeActionError(error)}</p>)}
    <section className="panel finance-management-panel">
      <div className="panel-head"><div><h2 className="panel-title">Nowy projekt</h2><p className="panel-kicker">Zaplanuj remont, podróż lub większy zakup.</p></div><button className="primary-button" type="button" disabled={saveProject.isPending} onClick={() => { saveProject.reset(); setEditingProject('new') }}>Dodaj projekt</button></div>
      {editingProject === 'new' && <ProjectForm project={null} pending={saveProject.isPending} onSave={input => saveProject.mutate(input)} onCancel={() => setEditingProject(null)} />}
    </section>
    {projects.isPending && <p role="status">Ładuję projekty…</p>}
    {projectList.length === 0 && !projects.isPending && <p className="panel-message">Brak projektów. Dodaj projekt, aby śledzić jego wydatki.</p>}
    {projectList.map(project => {
      const totals = !expenses.isPending && !expenses.isError ? calculateProjectTotals(project, expenseList) : null
      const projectExpenses = expenseList.filter(expense => expense.project_id === project.id)
      return <section className="panel finance-management-panel finance-project-card" key={project.id}>
        <div className="panel-head"><div><h2 className="panel-title">{project.name}{project.is_archived ? ' · archiwalny' : ''}</h2><p className="panel-kicker">{project.description}</p></div>
          {totals && <div className="finance-project-totals"><strong>Wydano: {formatPln(totals.spent)}</strong>{totals.target !== null && <span>Budżet: {formatPln(totals.target)} · zostało: {formatPln(totals.remaining!)}</span>}</div>}
        </div>
        {totals?.target && BigInt(project.target_budget ?? '0') > 0n && <progress className="finance-goal-progress" max={100} value={Math.min(100, Math.max(0, moneyRatio(totals.spent, totals.target) * 100))} aria-label={`Wykorzystanie budżetu: ${project.name}`} />}
        <div className="finance-edit-actions finance-project-actions">
          <button className="button-quiet" type="button" disabled={saveProject.isPending || deleteProject.isPending} onClick={() => { saveProject.reset(); setEditingProject(project.id) }}>Edytuj projekt</button>
          <button className="button-quiet" type="button" disabled={saveProject.isPending || deleteProject.isPending} onClick={() => saveProject.mutate({ id: project.id, expected_version: project.version, name: project.name, description: project.description, target_budget: project.target_budget == null ? null : financeMinorUnitsToMoney(project.target_budget), is_archived: !project.is_archived })}>{project.is_archived ? 'Przywróć' : 'Archiwizuj'}</button>
          {totals && !projectExpenses.length && <button className="button-quiet" type="button" disabled={saveProject.isPending || deleteProject.isPending} onClick={() => deleteProject.mutate(project)}>Usuń pusty projekt</button>}
          {!project.is_archived && <button className="primary-button" type="button" disabled={saveExpense.isPending} onClick={() => { saveExpense.reset(); setSelectedId(project.id); setEditingExpense('new') }}>Dodaj wydatek</button>}
        </div>
        {editingProject === project.id && <ProjectForm key={project.id} project={project} pending={saveProject.isPending} onSave={input => saveProject.mutate(input)} onCancel={() => setEditingProject(null)} />}
        {project.is_archived && <p className="panel-kicker">Projekt jest archiwalny. Przywróć go, aby dodawać i edytować wydatki.</p>}
        {expenses.isPending && <p role="status">Ładuję wydatki…</p>}
        {selectedId === project.id && editingExpense !== null && !project.is_archived && <ExpenseForm key={`${project.id}:${editingExpense}`} expense={expenseList.find(e => e.id === editingExpense) ?? null} projectId={project.id} pending={saveExpense.isPending} onSave={input => saveExpense.mutate(input)} onCancel={() => setEditingExpense(null)} />}
        {projectExpenses.map(expense => <div className="finance-management-row" key={expense.id}><div><strong>{expense.name}</strong><p>{expense.expense_date ?? 'Bez daty'}{expense.notes ? ` · ${expense.notes}` : ''}</p></div><strong>{formatPln(financeMinorUnitsToMoney(expense.amount))}</strong><div className="finance-edit-actions"><button className="button-quiet" type="button" disabled={project.is_archived || saveExpense.isPending || deleteExpense.isPending} onClick={() => { saveExpense.reset(); setSelectedId(project.id); setEditingExpense(expense.id) }}>Edytuj</button><button className="button-quiet" type="button" disabled={project.is_archived || saveExpense.isPending || deleteExpense.isPending} onClick={() => deleteExpense.mutate(expense)}>Usuń</button></div></div>)}
        {totals && !projectExpenses.length && <p className="panel-kicker">Brak wydatków w tym projekcie.</p>}
      </section>
    })}
  </div>
}
