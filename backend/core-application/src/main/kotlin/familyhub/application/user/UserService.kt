package familyhub.application.user

import familyhub.domain.user.User
import familyhub.domain.user.UserId
import familyhub.domain.user.UserRepository

class UnknownUser : RuntimeException("Unknown user")

class UserService(private val users: UserRepository) {

    fun identify(id: UserId): User = users.find(id) ?: throw UnknownUser()
}
