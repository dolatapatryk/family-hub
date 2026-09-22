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
        completed: Boolean = this.completed,
    ): ShoppingItem = copy(name = name.trim(), quantity = quantity, completed = completed)

    companion object {

        fun create(
            name: String,
            householdId: HouseholdId,
            quantity: String?,
            addedBy: UserId,
            now: Instant,
        ): ShoppingItem = ShoppingItem(
            id = randomShoppingItemId(),
            householdId = householdId,
            name = name.trim(),
            quantity = quantity,
            completed = false,
            addedBy = addedBy,
            createdAt = now,
        )
    }
}
