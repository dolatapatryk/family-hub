package familyhub.api.user

import familyhub.api.common.parseUuid
import familyhub.application.user.UnknownUser
import familyhub.application.user.UserService
import familyhub.domain.user.User
import familyhub.domain.user.UserId
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.BadRequestException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

suspend fun ApplicationCall.identifiedUser(users: UserService): User {
    val header = request.headers["X-User-Id"] ?: throw UnknownUser()
    val id = try {
        UserId(parseUuid(header, "X-User-Id"))
    } catch (_: BadRequestException) {
        throw UnknownUser()
    }
    return withContext(Dispatchers.IO) { users.identify(id) }
}
