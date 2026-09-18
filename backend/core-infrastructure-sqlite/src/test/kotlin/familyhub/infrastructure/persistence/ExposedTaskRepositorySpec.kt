package familyhub.infrastructure.persistence

import familyhub.domain.household.HouseholdId
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId
import familyhub.domain.task.TaskNotFound
import familyhub.domain.task.TaskTestData.author
import familyhub.domain.task.TaskTestData.now
import familyhub.domain.task.TaskTestData.partner
import familyhub.domain.task.TaskTestData.task
import familyhub.domain.task.TaskTestData.today
import familyhub.domain.user.UserId
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.nio.file.Path
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

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
        val original = task()
        tasks.save(original)

        val updated = original.update(title = "Dentist", dueDate = null).assignTo(partner.id).complete()
        tasks.save(updated)

        tasks.get(author.householdId, original.id) shouldBe updated
        tasks.list(TaskFilter(author.householdId)) shouldBe listOf(updated)
    }

    @Test
    fun `list combines completion assignment and inclusive date filters`() {
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

        tasks.list(filter) shouldBe listOf(expected)
        tasks.list(TaskFilter(author.householdId, completed = true)).size shouldBe 1
        tasks.list(TaskFilter(author.householdId, completed = false)).size shouldBe 5
        tasks.list(TaskFilter(author.householdId, assignedTo = UserId.randomUserId())).shouldBeEmpty()
    }

    @Test
    fun `get and list exclude other households`() {
        val existing = tasks.save(task())
        val otherHousehold = HouseholdId.randomHouseholdId()

        tasks.find(otherHousehold, existing.id).shouldBeNull()
        shouldThrow<TaskNotFound> { tasks.get(otherHousehold, existing.id) }
        tasks.find(author.householdId, TaskId.randomTaskId()).shouldBeNull()
        shouldThrow<TaskNotFound> { tasks.get(author.householdId, TaskId.randomTaskId()) }
        tasks.list(TaskFilter(otherHousehold)).shouldBeEmpty()
    }

    @Test
    fun `archive retains all data after reopening the database`() {
        val archived = tasks.save(task().assignTo(partner.id).complete().archive(now))
        val reopened = ExposedTaskRepository(DatabaseFactory(settings).initialize())

        reopened.get(author.householdId, archived.id) shouldBe archived
        reopened.list(TaskFilter(author.householdId)).shouldBeEmpty()
        reopened.list(TaskFilter(author.householdId, archived = true)) shouldBe listOf(archived)
    }

    @Test
    fun `failed application transaction rolls back a nested repository save`() {
        val original = tasks.save(task())

        shouldThrow<IllegalStateException> {
            transactions.execute {
                val loaded = tasks.get(author.householdId, original.id)
                tasks.save(loaded.complete())
                error("Abort the operation")
            }
        }

        tasks.get(author.householdId, original.id) shouldBe original
    }
}
