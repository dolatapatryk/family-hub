package familyhub.api.common

import familyhub.application.user.UnknownUser
import familyhub.domain.task.InvalidTask
import familyhub.domain.task.InvalidTaskFilter
import familyhub.domain.task.TaskArchived
import familyhub.domain.task.TaskNotFound
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException

@Serializable
data class ErrorResponse(val error: String)

fun Application.configureExceptionHandling() {
    install(StatusPages) {
        exception<UnknownUser> { call, _ ->
            call.respond(HttpStatusCode.Unauthorized, ErrorResponse("Missing, invalid, or unknown X-User-Id"))
        }
        exception<TaskNotFound> { call, _ ->
            call.respond(HttpStatusCode.NotFound, ErrorResponse("Task not found"))
        }
        exception<TaskArchived> { call, _ ->
            call.respond(HttpStatusCode.Conflict, ErrorResponse("Archived tasks cannot be changed"))
        }
        exception<InvalidTask> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ErrorResponse(cause.message ?: "Invalid task"))
        }
        exception<InvalidTaskFilter> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ErrorResponse(cause.message ?: "Invalid task filter"))
        }
        exception<BadRequestException> { call, _ ->
            call.respond(HttpStatusCode.BadRequest, ErrorResponse("Invalid request"))
        }
        exception<SerializationException> { call, _ ->
            call.respond(HttpStatusCode.BadRequest, ErrorResponse("Invalid JSON request"))
        }
    }
}
