package familyhub.domain.user

import familyhub.domain.household.HouseholdId

data class User(val id: UserId, val householdId: HouseholdId, val name: String)
