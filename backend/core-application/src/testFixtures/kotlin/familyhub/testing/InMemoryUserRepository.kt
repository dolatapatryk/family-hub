package familyhub.testing

import familyhub.domain.user.User
import familyhub.domain.user.UserId
import familyhub.domain.user.UserRepository

class InMemoryUserRepository : UserRepository {

    private val users = mutableMapOf<UserId, User>()

    override fun find(id: UserId): User? = users[id]

    override fun save(user: User): User {
        users[user.id] = user
        return user
    }
}
