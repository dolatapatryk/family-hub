package familyhub.domain.user

interface UserRepository {
    fun find(id: UserId): User?
    fun get(id: UserId): User = find(id) ?: throw UserNotFound(id)
    fun save(user: User): User
}
