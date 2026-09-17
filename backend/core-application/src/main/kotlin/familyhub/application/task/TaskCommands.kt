package familyhub.application.task

import java.time.LocalDate

sealed interface FieldChange<out T> {
    data object Unchanged : FieldChange<Nothing>
    data class Set<T>(val value: T) : FieldChange<T>
}

internal fun <T> FieldChange<T>.orElse(current: T): T = when (this) {
    FieldChange.Unchanged -> current
    is FieldChange.Set -> value
}

data class CreateTask(val title: String, val dueDate: LocalDate? = null)

data class UpdateTask(
    val title: String? = null,
    val dueDate: FieldChange<LocalDate?> = FieldChange.Unchanged,
)
