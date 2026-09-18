package familyhub.api.task

import familyhub.api.common.parseUuid
import familyhub.api.user.identifiedUser
import familyhub.application.task.TaskService
import familyhub.application.user.UserService
import familyhub.domain.task.TaskId
import familyhub.domain.user.UserId
import io.ktor.http.HttpStatusCode.Companion.Created
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

fun Route.taskRoutes(tasks: TaskService, users: UserService) {

    route("/api/tasks") {
        get {
            val user = call.identifiedUser(users)
            val filter = call.request.queryParameters.toTaskFilter(user.householdId)
            val result = withContext(Dispatchers.IO) {
                tasks.list(filter)
            }
            call.respond(result.map { it.toResponse() })
        }

        get("/{id}") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val task = withContext(Dispatchers.IO) {
                tasks.get(user, id)
            }
            call.respond(task.toResponse())
        }

        post {
            val user = call.identifiedUser(users)
            val command = call.receive<CreateTaskRequest>().toCommand()
            val task = withContext(Dispatchers.IO) {
                tasks.create(user, command)
            }
            call.respond(Created, task.toResponse())
        }

        patch("/{id}") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val command = call.receive<JsonObject>().toUpdateCommand()
            val task = withContext(Dispatchers.IO) {
                tasks.update(user, id, command)
            }
            call.respond(task.toResponse())
        }

        post("/{id}/assign") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val request = call.receive<AssignTaskRequest>()
            val assigneeId = UserId(parseUuid(request.assignedTo, "assignedTo"))
            val task = withContext(Dispatchers.IO) {
                tasks.assignTo(user, id, assigneeId)
            }
            call.respond(task.toResponse())
        }

        post("/{id}/unassign") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val task = withContext(Dispatchers.IO) {
                tasks.unassign(user, id)
            }
            call.respond(task.toResponse())
        }

        post("/{id}/complete") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val task = withContext(Dispatchers.IO) {
                tasks.complete(user, id)
            }
            call.respond(task.toResponse())
        }

        post("/{id}/reopen") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val task = withContext(Dispatchers.IO) {
                tasks.reopen(user, id)
            }
            call.respond(task.toResponse())
        }

        post("/{id}/archive") {
            val user = call.identifiedUser(users)
            val id = call.taskId()
            val task = withContext(Dispatchers.IO) {
                tasks.archive(user, id)
            }
            call.respond(task.toResponse())
        }
    }
}

private fun ApplicationCall.taskId(): TaskId =
    TaskId(parseUuid(parameters["id"] ?: throw BadRequestException("Missing task id"), "id"))
