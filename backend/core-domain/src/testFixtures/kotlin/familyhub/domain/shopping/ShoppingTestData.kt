package familyhub.domain.shopping

import familyhub.domain.household.HouseholdId.Companion.randomHouseholdId
import familyhub.domain.user.User
import familyhub.domain.user.UserId.Companion.randomUserId
import java.time.Instant

object ShoppingTestData {
    val householdId = randomHouseholdId()
    val author = User(randomUserId(), householdId, "Author")
    val partner = User(randomUserId(), householdId, "Partner")
    val outsider = User(randomUserId(), randomHouseholdId(), "Other household")
    val now: Instant = Instant.parse("2026-09-22T12:00:00Z")

    fun item(name: String = "Milk", quantity: String? = "2"): ShoppingItem =
        ShoppingItem.create(name, author.householdId, quantity, author.id, now)
}
