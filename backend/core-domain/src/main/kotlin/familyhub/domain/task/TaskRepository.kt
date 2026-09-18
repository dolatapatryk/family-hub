package familyhub.domain.task

import familyhub.domain.household.HouseholdId

interface TaskRepository {
    fun find(id: TaskId, householdId: HouseholdId): Task?
    fun get(id: TaskId, householdId: HouseholdId): Task = find(id, householdId) ?: throw TaskNotFound()
    fun list(filter: TaskFilter): List<Task>
    fun save(task: Task): Task
}
