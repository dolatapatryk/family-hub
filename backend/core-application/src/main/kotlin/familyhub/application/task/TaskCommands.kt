package familyhub.application.task

import familyhub.application.common.FieldChange
import familyhub.application.common.FieldChange.Unchanged
import java.time.LocalDate

data class CreateTask(val title: String, val dueDate: LocalDate? = null)

data class UpdateTask(
    val title: String? = null,
    val dueDate: FieldChange<LocalDate?> = Unchanged,
)
