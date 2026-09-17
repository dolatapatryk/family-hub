package familyhub.testing

import familyhub.domain.household.HouseholdId
import familyhub.domain.task.Task
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId
import familyhub.domain.task.TaskRepository

class InMemoryTaskRepository : TaskRepository {
    private val tasks = mutableMapOf<TaskId, Task>()

    override fun find(householdId: HouseholdId, id: TaskId): Task? =
        tasks[id]?.takeIf { it.householdId == householdId }

    override fun save(task: Task): Task {
        tasks[task.id] = task
        return task
    }

    override fun list(filter: TaskFilter): List<Task> = tasks.values
        .filter { it.matches(filter) }
        .sortedWith(compareBy<Task> { it.createdAt }.thenBy { it.id.toString() })

    private fun Task.matches(filter: TaskFilter): Boolean {
        val date = dueDate
        val from = filter.from
        val to = filter.to
        return householdId == filter.householdId &&
            (archivedAt != null) == filter.archived &&
            (filter.completed == null || completed == filter.completed) &&
            (from == null || (date != null && date >= from)) &&
            (to == null || (date != null && date <= to)) &&
            (filter.assignedTo == null || assignedTo == filter.assignedTo)
    }
}
