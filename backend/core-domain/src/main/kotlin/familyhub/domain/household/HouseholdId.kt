package familyhub.domain.household

import java.util.UUID

@JvmInline
value class HouseholdId(val id: UUID) {
    override fun toString(): String = id.toString()

    companion object {
        fun random(): HouseholdId = HouseholdId(UUID.randomUUID())
    }
}
