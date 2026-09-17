package familyhub.api.task

import kotlinx.serialization.Serializable

@Serializable
data class CreateTaskRequest(
    val title: String,
    val dueDate: String? = null,
)

@Serializable
data class UpdateTaskRequest(
    val title: String? = null,
    val dueDate: String? = null,
)

@Serializable
data class AssignTaskRequest(val assignedTo: String)

@Serializable
data class TaskResponse(
    val id: String,
    val title: String,
    val dueDate: String?,
    val completed: Boolean,
    val assignedTo: String?,
    val createdBy: String,
    val createdAt: String,
    val archivedAt: String?,
)
