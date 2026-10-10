import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFinanceApi } from './api'
import { calculateProjectTotals } from './calculations'
import { financeMinorUnitsToMoney, formatPln } from './money'
import { financeActionError, useFinanceAction } from './useFinanceAction'
import type { FinanceProject, FinanceProjectExpense, FinanceSaveProjectInput, FinanceSaveProjectExpenseInput } from './types'

function ProjectForm({ project, pending, onSave, onCancel }: { project: FinanceProject | null; pending: boolean; onSave: (input: Omit<FinanceSaveProjectInput, 'request_id'>) => void; onCancel: () => void }) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [target, setTarget] = useState(project?.target_budget == null ? '' : financeMinorUnitsToMoney(project.target_budget))
  return <form className="finance-management-form" onSubmit={e => { e.preventDefault(); onSave({ id: project?.id, expected_version: project?.version, name, description: description.trim() || null, target_budget: target.trim() || null, is_archived: project?.is_archived ?? false, sort_order: project?.sort_order ?? 0 }) }}>
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
  return <form className="finance-management-form" onSubmit={e => { e.preventDefault(); onSave({ id: expense?.id, expected_version: expense?.version, project_id: projectId, expense_date: date || null, name, amount, notes: notes.trim() || null, sort_order: expense?.sort_order ?? 0 }) }}>
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
  const selected = projectList.find(p => p.id === selectedId)
  useEffect(() => {
    if (!projectList.some(p => p.id === selectedId)) setSelectedId(projectList[0]?.id ?? '')
  }, [projectList, selectedId])
  const saveProject = useFinanceAction((input: Omit<FinanceSaveProjectInput, 'request_id'>, request_id) => api.saveProject({ ...input, request_id }), [projectsKey], () => setEditingProject(null), () => setEditingProject(null))
  const deleteProject = useFinanceAction((project: FinanceProject, request_id) => api.deleteProject({ request_id, id: project.id, expected_version: project.version }), [projectsKey])
  const saveExpense = useFinanceAction((input: Omit<FinanceSaveProjectExpenseInput, 'request_id'>, request_id) => api.saveProjectExpense({ ...input, request_id }), [expensesKey], () => setEditingExpense(null), () => setEditingExpense(null))
  const deleteExpense = useFinanceAction((expense: FinanceProjectExpense, request_id) => api.deleteProjectExpense({ request_id, id: expense.id, expected_version: expense.version }), [expensesKey])
  const errors = [projects.error, expenses.error, saveProject.error, deleteProject.error, saveExpense.error, deleteExpense.error].filter(Boolean)
  return <div className="finance-management-stack">
    {errors.map((error, i) => <p className="error-message" role="alert" key={i}>{financeActionError(error)}</p>)}
    <section className="panel finance-management-panel">
      <div className="panel-head"><div><h2 className="panel-title">Projekty domowe</h2><p className="panel-kicker">Wydatki projektu są osobną ewidencją i nie zmieniają budżetu miesięcznego.</p></div><button className="primary-button" type="button" disabled={saveProject.isPending} onClick={() => { saveProject.reset(); setEditingProject('new') }}>Dodaj projekt</button></div>
      {projects.isPending && <p role="status">Ładuję projekty…</p>}
      {editingProject !== null && <ProjectForm key={editingProject} project={projectList.find(p => p.id === editingProject) ?? null} pending={saveProject.isPending} onSave={input => saveProject.mutate(input)} onCancel={() => setEditingProject(null)} />}
      {projectList.length === 0 && !projects.isPending && <p>Brak projektów. Dodaj projekt, aby śledzić jego wydatki.</p>}
      {projectList.map(project => {
        const totals = !expenses.isPending && !expenses.isError ? calculateProjectTotals(project, expenseList) : null
        return <div className="finance-management-row" key={project.id}>
          <button className="button-quiet" type="button" aria-pressed={selectedId === project.id} onClick={() => { setSelectedId(project.id); setEditingExpense(null) }}><strong>{project.name}{project.is_archived ? ' · archiwalny' : ''}</strong></button>
          {totals ? <div>Wydano: {formatPln(totals.spent)}<br />{totals.remaining !== null ? `Pozostało: ${formatPln(totals.remaining)}` : 'Bez budżetu docelowego'}</div> : <span>Ładuję sumę wydatków…</span>}
          <div className="finance-edit-actions">
            <button className="button-quiet" type="button" disabled={saveProject.isPending || deleteProject.isPending} onClick={() => { saveProject.reset(); setEditingProject(project.id) }}>Edytuj</button>
            <button className="button-quiet" type="button" disabled={saveProject.isPending || deleteProject.isPending} onClick={() => saveProject.mutate({ id: project.id, expected_version: project.version, name: project.name, description: project.description, target_budget: project.target_budget == null ? null : financeMinorUnitsToMoney(project.target_budget), is_archived: !project.is_archived, sort_order: project.sort_order })}>{project.is_archived ? 'Przywróć' : 'Archiwizuj'}</button>
            {!expenses.isPending && !expenses.isError && !expenseList.some(e => e.project_id === project.id) && <button className="button-quiet" type="button" disabled={saveProject.isPending || deleteProject.isPending} onClick={() => deleteProject.mutate(project)}>Usuń pusty projekt</button>}
          </div>
        </div>
      })}
    </section>
    {selected && <section className="panel finance-management-panel">
      <div className="panel-head"><div><h2 className="panel-title">Wydatki · {selected.name}</h2><p className="panel-kicker">{selected.description}</p>{selected.target_budget && <p>Budżet docelowy: {formatPln(financeMinorUnitsToMoney(selected.target_budget))}</p>}</div>{!selected.is_archived && <button className="primary-button" type="button" disabled={saveExpense.isPending} onClick={() => { saveExpense.reset(); setEditingExpense('new') }}>Dodaj wydatek</button>}</div>
      {selected.is_archived && <p>Projekt jest archiwalny. Historia pozostaje dostępna; przywróć go przed dodaniem lub edycją wydatków.</p>}
      {expenses.isPending && <p role="status">Ładuję wydatki…</p>}
      {editingExpense !== null && !selected.is_archived && <ExpenseForm key={`${selected.id}:${editingExpense}`} expense={expenseList.find(e => e.id === editingExpense) ?? null} projectId={selected.id} pending={saveExpense.isPending} onSave={input => saveExpense.mutate(input)} onCancel={() => setEditingExpense(null)} />}
      {expenseList.filter(e => e.project_id === selected.id).map(expense => <div className="finance-management-row" key={expense.id}><div><strong>{expense.name}</strong><p>{expense.expense_date ?? 'Bez daty'}{expense.notes ? ` · ${expense.notes}` : ''}</p></div><strong>{formatPln(financeMinorUnitsToMoney(expense.amount))}</strong><div className="finance-edit-actions"><button className="button-quiet" type="button" disabled={selected.is_archived || saveExpense.isPending || deleteExpense.isPending} onClick={() => { saveExpense.reset(); setEditingExpense(expense.id) }}>Edytuj</button><button className="button-quiet" type="button" disabled={selected.is_archived || saveExpense.isPending || deleteExpense.isPending} onClick={() => deleteExpense.mutate(expense)}>Usuń</button></div></div>)}
      {!expenses.isPending && !expenses.isError && !expenseList.some(e => e.project_id === selected.id) && <p>Brak wydatków w tym projekcie.</p>}
    </section>}
  </div>
}
