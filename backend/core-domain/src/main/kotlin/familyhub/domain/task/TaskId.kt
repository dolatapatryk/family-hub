package familyhub.domain.task

import java.util.UUID

@JvmInline
value class TaskId(val id: UUID) {
    override fun toString(): String = id.toString()

    companion object {
        fun random(): TaskId = TaskId(UUID.randomUUID())
    }
}
