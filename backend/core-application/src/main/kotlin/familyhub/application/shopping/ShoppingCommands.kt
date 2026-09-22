package familyhub.application.shopping

import familyhub.application.common.FieldChange
import familyhub.application.common.FieldChange.Unchanged

data class CreateShoppingItem(val name: String, val quantity: String? = null)

data class UpdateShoppingItem(
    val name: String? = null,
    val quantity: FieldChange<String?> = Unchanged,
    val completed: Boolean? = null,
)
