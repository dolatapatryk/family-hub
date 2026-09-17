package familyhub.domain.user

class UserNotFound(id: UserId) : RuntimeException("User $id not found")
