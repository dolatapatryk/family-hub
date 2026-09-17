package familyhub.domain.task

import familyhub.domain.household.HouseholdId

interface TaskRepository {
    fun find(householdId: HouseholdId, id: TaskId): Task?
    fun get(householdId: HouseholdId, id: TaskId): Task = find(householdId, id) ?: throw TaskNotFound()
    fun list(filter: TaskFilter): List<Task>
    fun save(task: Task): Task
}
