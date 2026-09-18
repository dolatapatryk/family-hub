package familyhub.application.task

import familyhub.application.task.FieldChange.Set
import familyhub.application.task.FieldChange.Unchanged
import java.time.LocalDate

sealed interface FieldChange<out T> {
    data object Unchanged : FieldChange<Nothing>
    data class Set<T>(val value: T) : FieldChange<T>
}

internal fun <T> FieldChange<T>.orElse(current: T): T = when (this) {
    is Unchanged -> current
    is Set -> value
}

data class CreateTask(val title: String, val dueDate: LocalDate? = null)

data class UpdateTask(
    val title: String? = null,
    val dueDate: FieldChange<LocalDate?> = Unchanged,
)
