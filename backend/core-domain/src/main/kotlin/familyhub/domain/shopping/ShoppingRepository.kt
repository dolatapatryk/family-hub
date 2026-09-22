package familyhub.domain.shopping

import familyhub.domain.household.HouseholdId

interface ShoppingRepository {
    fun find(id: ShoppingItemId, householdId: HouseholdId): ShoppingItem?
    fun get(id: ShoppingItemId, householdId: HouseholdId): ShoppingItem =
        find(id, householdId) ?: throw ShoppingItemNotFound()
    fun list(filter: ShoppingFilter): List<ShoppingItem>
    fun save(item: ShoppingItem): ShoppingItem
    fun delete(id: ShoppingItemId, householdId: HouseholdId)
}
