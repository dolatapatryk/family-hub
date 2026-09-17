package familyhub.domain.task

import familyhub.domain.household.HouseholdId
import familyhub.domain.user.User
import familyhub.domain.user.UserId
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

object TaskTestData {
    val householdId = HouseholdId(UUID.fromString("00000000-0000-0000-0000-000000000001"))
    val author = User(UserId(UUID.fromString("00000000-0000-0000-0000-000000000101")), householdId, "Author")
    val partner = User(UserId(UUID.fromString("00000000-0000-0000-0000-000000000102")), householdId, "Partner")
    val outsider = User(UserId.random(), HouseholdId.random(), "Other household")
    val today: LocalDate = LocalDate.parse("2026-09-17")
    val now: Instant = Instant.parse("2026-09-17T12:00:00Z")

    fun task(title: String = "Call doctor", dueDate: LocalDate? = today): Task =
        Task.create(title, dueDate, author.householdId, author.id, now)
}
