package familyhub.domain.task

import familyhub.domain.household.HouseholdId
import familyhub.domain.task.TaskId.Companion.randomTaskId
import familyhub.domain.user.UserId
import java.time.Instant
import java.time.LocalDate

data class Task(
    val id: TaskId,
    val householdId: HouseholdId,
    val title: String,
    val dueDate: LocalDate?,
    val completed: Boolean,
    val assignedTo: UserId?,
    val createdBy: UserId,
    val createdAt: Instant,
    val archivedAt: Instant? = null,
) {
    init {
        if (title.isBlank()) {
            throw InvalidTask("title must not be blank")
        }
    }

    fun update(title: String = this.title, dueDate: LocalDate? = this.dueDate): Task {
        ensureActive()
        return copy(title = title.trim(), dueDate = dueDate)
    }

    fun assignTo(userId: UserId): Task {
        ensureActive()
        return copy(assignedTo = userId)
    }

    fun unassign(): Task {
        ensureActive()
        return copy(assignedTo = null)
    }

    fun complete(): Task {
        ensureActive()
        if (completed) {
            return this
        }
        return copy(completed = true)
    }

    fun reopen(): Task {
        ensureActive()
        if (!completed) {
            return this
        }
        return copy(completed = false)
    }

    fun archive(now: Instant): Task {
        if (archivedAt != null) {
            return this
        }
        return copy(archivedAt = now)
    }

    private fun ensureActive() {
        if (archivedAt != null) {
            throw TaskArchived()
        }
    }

    companion object {

        fun create(
            title: String,
            householdId: HouseholdId,
            dueDate: LocalDate?,
            createdBy: UserId,
            now: Instant,
        ): Task = Task(
            id = randomTaskId(),
            householdId = householdId,
            title = title.trim(),
            dueDate = dueDate,
            completed = false,
            assignedTo = null,
            createdBy = createdBy,
            createdAt = now,
        )
    }
}
