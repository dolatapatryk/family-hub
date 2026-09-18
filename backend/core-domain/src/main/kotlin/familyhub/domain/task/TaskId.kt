package familyhub.domain.task

import java.util.UUID
import java.util.UUID.randomUUID

@JvmInline
value class TaskId(val id: UUID) {
    override fun toString(): String = id.toString()

    companion object {
        fun randomTaskId(): TaskId = TaskId(randomUUID())
    }
}
