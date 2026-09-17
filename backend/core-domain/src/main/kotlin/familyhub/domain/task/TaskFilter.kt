package familyhub.domain.task

import familyhub.domain.household.HouseholdId
import familyhub.domain.user.UserId
import java.time.LocalDate

data class TaskFilter(
    val householdId: HouseholdId,
    val completed: Boolean? = null,
    val from: LocalDate? = null,
    val to: LocalDate? = null,
    val assignedTo: UserId? = null,
    val archived: Boolean = false,
) {
    init {
        if (from != null && to != null && from > to) {
            throw InvalidTaskFilter("from must be on or before to")
        }
    }
}

class InvalidTaskFilter(message: String) : RuntimeException(message)
