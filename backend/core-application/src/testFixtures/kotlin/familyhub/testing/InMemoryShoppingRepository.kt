package familyhub.testing

import familyhub.domain.household.HouseholdId
import familyhub.domain.shopping.ShoppingFilter
import familyhub.domain.shopping.ShoppingItem
import familyhub.domain.shopping.ShoppingItemId
import familyhub.domain.shopping.ShoppingRepository

class InMemoryShoppingRepository : ShoppingRepository {

    private val items = mutableMapOf<ShoppingItemId, ShoppingItem>()

    override fun find(id: ShoppingItemId, householdId: HouseholdId): ShoppingItem? =
        items[id]?.takeIf { it.householdId == householdId }

    override fun list(filter: ShoppingFilter): List<ShoppingItem> = items.values
        .filter { it.householdId == filter.householdId && it.completed == filter.completed }
        .sortedWith(compareBy<ShoppingItem> { it.createdAt }.thenBy { it.id.toString() })

    override fun save(item: ShoppingItem): ShoppingItem {
        items[item.id] = item
        return item
    }

    override fun delete(id: ShoppingItemId, householdId: HouseholdId) {
        if (find(id, householdId) != null) items.remove(id)
    }
}
