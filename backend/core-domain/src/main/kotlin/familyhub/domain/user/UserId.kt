package familyhub.domain.user

import java.util.UUID

@JvmInline
value class UserId(val id: UUID) {
    override fun toString(): String = id.toString()

    companion object {
        fun random(): UserId = UserId(UUID.randomUUID())
    }
}
