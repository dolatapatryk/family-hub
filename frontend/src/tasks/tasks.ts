export interface Task {
  id: string
  title: string
  dueDate: string | null
  completed: boolean
  assignedTo: string | null
  createdAt: string
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function groupTasks(tasks: Task[], today = localDate()) {
  const groups: Record<string, Task[]> = { Overdue: [], Today: [], Upcoming: [], 'No due date': [], Completed: [] }
  for (const task of [...tasks].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt))) {
    const group = task.completed ? 'Completed' : !task.dueDate ? 'No due date' : task.dueDate < today ? 'Overdue' : task.dueDate === today ? 'Today' : 'Upcoming'
    groups[group].push(task)
  }
  return groups
}

export function formatDueDate(date: string) {
  // Parse date-only values locally, avoiding a UTC shift to the previous day.
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day))
}
