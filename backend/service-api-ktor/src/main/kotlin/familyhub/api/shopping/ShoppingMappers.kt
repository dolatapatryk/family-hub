package familyhub.api.shopping

import familyhub.api.common.parseBoolean
import familyhub.application.common.FieldChange
import familyhub.application.shopping.CreateShoppingItem
import familyhub.application.shopping.UpdateShoppingItem
import familyhub.domain.household.HouseholdId
import familyhub.domain.shopping.ShoppingFilter
import familyhub.domain.shopping.ShoppingItem
import io.ktor.http.Parameters
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

fun CreateShoppingItemRequest.toCommand(): CreateShoppingItem = CreateShoppingItem(name, quantity, store)

fun JsonObject.toUpdateCommand(): UpdateShoppingItem {
    if (this["name"] == JsonNull) throw BadRequestException("name cannot be null")
    if (this["completed"] == JsonNull) throw BadRequestException("completed cannot be null")
    val request = Json.decodeFromJsonElement<UpdateShoppingItemRequest>(this)
    return UpdateShoppingItem(
        name = request.name,
        quantity = if (containsKey("quantity")) FieldChange.Set(request.quantity) else FieldChange.Unchanged,
        store = if (containsKey("store")) FieldChange.Set(request.store) else FieldChange.Unchanged,
        completed = request.completed,
    )
}

fun Parameters.toShoppingFilter(householdId: HouseholdId): ShoppingFilter = ShoppingFilter(
    householdId = householdId,
    completed = get("completed")?.let { parseBoolean(it, "completed") } ?: false,
)

fun ShoppingItem.toResponse(): ShoppingItemResponse = ShoppingItemResponse(
    id = id.toString(),
    name = name,
    quantity = quantity,
    store = store,
    completed = completed,
    addedBy = addedBy.toString(),
    createdAt = createdAt.toString(),
)
