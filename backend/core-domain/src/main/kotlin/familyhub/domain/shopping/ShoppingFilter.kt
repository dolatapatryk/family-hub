package familyhub.domain.shopping

import familyhub.domain.household.HouseholdId

data class ShoppingFilter(
    val householdId: HouseholdId,
    val completed: Boolean = false,
)
