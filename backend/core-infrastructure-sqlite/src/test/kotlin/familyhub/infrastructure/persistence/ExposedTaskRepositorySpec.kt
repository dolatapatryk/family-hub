package familyhub.infrastructure.persistence

import familyhub.domain.household.HouseholdId.Companion.randomHouseholdId
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId.Companion.randomTaskId
import familyhub.domain.task.TaskNotFound
import familyhub.domain.task.TaskTestData.author
import familyhub.domain.task.TaskTestData.partner
import familyhub.domain.task.TaskTestData.task
import familyhub.domain.task.TaskTestData.today
import familyhub.domain.user.UserId
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class ExposedTaskRepositorySpec {

    @TempDir
    lateinit var directory: Path
    private lateinit var settings: DatabaseSettings
    private lateinit var tasks: ExposedTaskRepository
    private lateinit var transactions: ExposedTransactionRunner

    @BeforeEach
    fun setUp() {
        settings = DatabaseSettings(directory.resolve("family.db").toString())
        val database = DatabaseFactory(settings).initialize()
        tasks = ExposedTaskRepository(database)
        transactions = ExposedTransactionRunner(database)
    }

    @Test
    fun `save inserts and updates the same task without duplicating it`() {
        // given
        val original = task()
        tasks.save(original)

        // when
        val updated = original.update(title = "Dentist", dueDate = null).assignTo(partner.id).complete()
        tasks.save(updated)

        // then
        tasks.get(original.id, author.householdId) shouldBe updated
        tasks.list(TaskFilter(author.householdId)) shouldBe listOf(updated)
    }

    @Test
    fun `list combines completion assignment and inclusive date filters`() {
        // given
        val expected = task().assignTo(partner.id)
        tasks.save(expected)
        tasks.save(task(dueDate = null).assignTo(partner.id))
        tasks.save(task(dueDate = today.minusDays(1)).assignTo(partner.id))
        tasks.save(task(dueDate = today.plusDays(1)).assignTo(partner.id))
        tasks.save(task().assignTo(partner.id).complete())
        tasks.save(task())
        val filter = TaskFilter(
            householdId = author.householdId,
            completed = false,
            from = today,
            to = today,
            assignedTo = partner.id,
        )

        // then
        tasks.list(filter) shouldBe listOf(expected)
        tasks.list(TaskFilter(author.householdId, completed = true)).size shouldBe 1
        tasks.list(TaskFilter(author.householdId, completed = false)).size shouldBe 5
        tasks.list(TaskFilter(author.householdId, assignedTo = UserId.randomUserId())).shouldBeEmpty()
    }

    @Test
    fun `get and list exclude other households`() {
        // given
        val existing = tasks.save(task())
        val otherHousehold = randomHouseholdId()

        // then
        tasks.find(existing.id, otherHousehold).shouldBeNull()
        shouldThrow<TaskNotFound> {
            tasks.get(existing.id, otherHousehold)
        }
        tasks.find(randomTaskId(), author.householdId).shouldBeNull()
        shouldThrow<TaskNotFound> {
            tasks.get(randomTaskId(), author.householdId)
        }
        tasks.list(TaskFilter(otherHousehold)).shouldBeEmpty()
    }
}
