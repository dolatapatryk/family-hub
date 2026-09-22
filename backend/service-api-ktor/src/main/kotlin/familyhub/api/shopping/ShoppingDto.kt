package familyhub.api.shopping

import kotlinx.serialization.Serializable

@Serializable
data class CreateShoppingItemRequest(val name: String, val quantity: String? = null)

@Serializable
data class UpdateShoppingItemRequest(
    val name: String? = null,
    val quantity: String? = null,
    val completed: Boolean? = null,
)

@Serializable
data class ShoppingItemResponse(
    val id: String,
    val name: String,
    val quantity: String?,
    val completed: Boolean,
    val addedBy: String,
    val createdAt: String,
)
