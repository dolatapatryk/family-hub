package familyhub.application.common

import familyhub.application.common.FieldChange.Set
import familyhub.application.common.FieldChange.Unchanged

sealed interface FieldChange<out T> {
    data object Unchanged : FieldChange<Nothing>
    data class Set<T>(val value: T) : FieldChange<T>
}

internal fun <T> FieldChange<T>.orElse(current: T): T = when (this) {
    is Unchanged -> current
    is Set -> value
}
