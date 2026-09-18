package familyhub.domain.task

import familyhub.domain.household.HouseholdId.Companion.randomHouseholdId
import familyhub.domain.user.User
import familyhub.domain.user.UserId.Companion.randomUserId
import java.time.Instant
import java.time.LocalDate

object TaskTestData {
    val householdId = randomHouseholdId()
    val author = User(randomUserId(), householdId, "Author")
    val partner = User(randomUserId(), householdId, "Partner")
    val outsider = User(randomUserId(), randomHouseholdId(), "Other household")
    val today: LocalDate = LocalDate.parse("2026-09-17")
    val now: Instant = Instant.parse("2026-09-17T12:00:00Z")

    fun task(title: String = "Call doctor", dueDate: LocalDate? = today): Task =
        Task.create(title, author.householdId, dueDate, author.id, now)
}
