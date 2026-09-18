package familyhub.infrastructure.persistence

import familyhub.domain.task.TaskTestData.author
import familyhub.domain.user.User
import familyhub.domain.user.UserId
import familyhub.domain.user.UserNotFound
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.nio.file.Path
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class ExposedUserRepositorySpec {
    @TempDir
    lateinit var directory: Path

    @Test
    fun `get reads seeded users and save inserts and updates users`() {
        val database = DatabaseFactory(DatabaseSettings(directory.resolve("family.db").toString())).initialize()
        val users = ExposedUserRepository(database)
        users.find(author.id).shouldNotBeNull()
        users.get(author.id) shouldBe users.find(author.id)
        val missingId = UserId.randomUserId()
        users.find(missingId).shouldBeNull()
        shouldThrow<UserNotFound> { users.get(missingId) }

        val user = User(UserId.randomUserId(), author.householdId, "New member")
        users.save(user)
        users.get(user.id) shouldBe user

        val renamed = user.copy(name = "Renamed member")
        users.save(renamed)
        users.get(user.id) shouldBe renamed
    }
}
