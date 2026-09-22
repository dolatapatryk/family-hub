package familyhub.api.shopping

import familyhub.api.common.parseUuid
import familyhub.api.user.identifiedUser
import familyhub.application.shopping.ShoppingService
import familyhub.application.user.UserService
import familyhub.domain.shopping.ShoppingItemId
import io.ktor.http.HttpStatusCode.Companion.Created
import io.ktor.http.HttpStatusCode.Companion.NoContent
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

fun Route.shoppingRoutes(items: ShoppingService, users: UserService) {
    route("/api/shopping-items") {
        get {
            val user = call.identifiedUser(users)
            val filter = call.request.queryParameters.toShoppingFilter(user.householdId)
            val result = withContext(Dispatchers.IO) {
                items.list(filter)
            }
            call.respond(result.map { it.toResponse() })
        }

        post {
            val user = call.identifiedUser(users)
            val command = call.receive<CreateShoppingItemRequest>().toCommand()
            val item = withContext(Dispatchers.IO) {
                items.create(user, command)
            }
            call.respond(Created, item.toResponse())
        }

        patch("/{id}") {
            val user = call.identifiedUser(users)
            val id = call.shoppingItemId()
            val command = call.receive<JsonObject>().toUpdateCommand()
            val item = withContext(Dispatchers.IO) {
                items.update(user, id, command)
            }
            call.respond(item.toResponse())
        }

        delete("/{id}") {
            val user = call.identifiedUser(users)
            val id = call.shoppingItemId()
            withContext(Dispatchers.IO) {
                items.delete(user, id)
            }
            call.respond(NoContent)
        }
    }
}

private fun ApplicationCall.shoppingItemId(): ShoppingItemId =
    ShoppingItemId(parseUuid(parameters["id"] ?: throw BadRequestException("Missing shopping item id"), "id"))
