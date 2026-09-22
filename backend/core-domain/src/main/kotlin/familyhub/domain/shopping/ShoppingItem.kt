package familyhub.domain.shopping

import familyhub.domain.household.HouseholdId
import familyhub.domain.shopping.ShoppingItemId.Companion.randomShoppingItemId
import familyhub.domain.user.UserId
import java.time.Instant

data class ShoppingItem(
    val id: ShoppingItemId,
    val householdId: HouseholdId,
    val name: String,
    val quantity: String?,
    val store: String?,
    val completed: Boolean,
    val addedBy: UserId,
    val createdAt: Instant,
) {
    init {
        if (name.isBlank()) {
            throw InvalidShoppingItem("name must not be blank")
        }
    }

    fun update(
        name: String = this.name,
        quantity: String? = this.quantity,
        store: String? = this.store,
        completed: Boolean = this.completed,
    ): ShoppingItem = copy(
        name = name.trim(),
        quantity = quantity,
        store = store.normalizedStore(),
        completed = completed,
    )

    companion object {

        fun create(
            name: String,
            householdId: HouseholdId,
            quantity: String?,
            addedBy: UserId,
            now: Instant,
            store: String? = null,
        ): ShoppingItem = ShoppingItem(
            id = randomShoppingItemId(),
            householdId = householdId,
            name = name.trim(),
            quantity = quantity,
            store = store.normalizedStore(),
            completed = false,
            addedBy = addedBy,
            createdAt = now,
        )
    }
}

private fun String?.normalizedStore(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
