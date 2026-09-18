package familyhub.domain.user

import java.util.UUID
import java.util.UUID.randomUUID

@JvmInline
value class UserId(val id: UUID) {
    override fun toString(): String = id.toString()

    companion object {
        fun randomUserId(): UserId = UserId(randomUUID())
    }
}
