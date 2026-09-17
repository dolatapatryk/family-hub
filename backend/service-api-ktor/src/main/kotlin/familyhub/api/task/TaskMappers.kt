package familyhub.api.task

import familyhub.api.common.parseBoolean
import familyhub.api.common.parseDate
import familyhub.api.common.parseUuid
import familyhub.application.task.CreateTask
import familyhub.application.task.FieldChange
import familyhub.application.task.UpdateTask
import familyhub.domain.household.HouseholdId
import familyhub.domain.task.Task
import familyhub.domain.task.TaskFilter
import familyhub.domain.user.UserId
import io.ktor.http.Parameters
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

fun CreateTaskRequest.toCommand(): CreateTask = CreateTask(
    title = title,
    dueDate = dueDate?.let { parseDate(it, "dueDate") },
)

fun JsonObject.toUpdateCommand(): UpdateTask {
    if (this["title"] == JsonNull) throw BadRequestException("title cannot be null")
    val request = Json.decodeFromJsonElement<UpdateTaskRequest>(this)
    return UpdateTask(
        title = request.title,
        dueDate = if (containsKey("dueDate")) {
            FieldChange.Set(request.dueDate?.let { parseDate(it, "dueDate") })
        } else {
            FieldChange.Unchanged
        },
    )
}

fun Parameters.toTaskFilter(householdId: HouseholdId): TaskFilter = TaskFilter(
    householdId = householdId,
    completed = get("completed")?.let { parseBoolean(it, "completed") },
    from = get("from")?.let { parseDate(it, "from") },
    to = get("to")?.let { parseDate(it, "to") },
    assignedTo = get("assignedTo")?.let { UserId(parseUuid(it, "assignedTo")) },
    archived = get("archived")?.let { parseBoolean(it, "archived") } ?: false,
)

fun Task.toResponse(): TaskResponse = TaskResponse(
    id = id.toString(),
    title = title,
    dueDate = dueDate?.toString(),
    completed = completed,
    assignedTo = assignedTo?.toString(),
    createdBy = createdBy.toString(),
    createdAt = createdAt.toString(),
    archivedAt = archivedAt?.toString(),
)
