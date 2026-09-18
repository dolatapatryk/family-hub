package familyhub.domain.household

import java.util.UUID
import java.util.UUID.randomUUID

@JvmInline
value class HouseholdId(val id: UUID) {

    override fun toString(): String = id.toString()

    companion object {
        fun randomHouseholdId(): HouseholdId = HouseholdId(randomUUID())
    }
}
