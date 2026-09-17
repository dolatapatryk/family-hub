package familyhub.application.user

import familyhub.domain.task.TaskTestData.author
import familyhub.testing.InMemoryUserRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class UserServiceTest {
    private val users = InMemoryUserRepository()
    private val service = UserService(users)

    @Test
    fun `identification returns the persisted user`() {
        users.save(author)

        service.identify(author.id) shouldBe author
    }

    @Test
    fun `identification rejects unknown users`() {
        shouldThrow<UnknownUser> { service.identify(author.id) }
    }
}
