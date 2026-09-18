package familyhub.application.task

import familyhub.application.task.FieldChange.Set
import familyhub.domain.task.InvalidTask
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId.Companion.randomTaskId
import familyhub.domain.task.TaskNotFound
import familyhub.domain.task.TaskTestData.author
import familyhub.domain.task.TaskTestData.now
import familyhub.domain.task.TaskTestData.outsider
import familyhub.domain.task.TaskTestData.partner
import familyhub.domain.task.TaskTestData.task
import familyhub.domain.task.TaskTestData.today
import familyhub.testing.DirectTransactionRunner
import familyhub.testing.InMemoryTaskRepository
import familyhub.testing.InMemoryUserRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Clock.fixed
import java.time.ZoneOffset.UTC

class TaskServiceTest {

    private val tasks = InMemoryTaskRepository()
    private val users = InMemoryUserRepository()
    private val service = TaskService(
        tasks,
        users,
        DirectTransactionRunner(),
        fixed(now, UTC)
    )

    @BeforeEach
    fun setUp() {
        users.save(author)
        users.save(partner)
        users.save(outsider)
    }

    @Test
    fun `create saves a task with the caller and clock`() {
        // when
        val created = service.create(author, CreateTask("Doctor", today))

        // then
        tasks.get(created.id, author.householdId) shouldBe created
        created.createdBy shouldBe author.id
        created.createdAt shouldBe now
        created.completed.shouldBeFalse()
    }

    @Test
    fun `get returns a task to another member of the household`() {
        // given
        val existing = tasks.save(task())

        // then
        service.get(partner, existing.id) shouldBe existing
    }

    @Test
    fun `update saves edited details and preserves omitted due date`() {
        // given
        val existing = tasks.save(task().assignTo(partner.id).complete())

        // when
        val updated = service.update(author, existing.id, UpdateTask(title = "Dentist"))

        // then
        updated shouldBe existing.update(title = "Dentist")
        tasks.get(existing.id, author.householdId) shouldBe updated
    }

    @Test
    fun `update can explicitly clear due date`() {
        // given
        val existing = tasks.save(task())

        // when
        service.update(author, existing.id, UpdateTask(dueDate = Set(null)))

        // then
        tasks.get(existing.id, author.householdId).dueDate.shouldBeNull()
    }

    @Test
    fun `assign resolves the user and saves the assigned task`() {
        // given
        val existing = tasks.save(task())

        // when
        val assigned = service.assignTo(author, existing.id, partner.id)

        // then
        assigned shouldBe existing.assignTo(partner.id)
        tasks.get(existing.id, author.householdId) shouldBe assigned
        service.unassign(author, existing.id)
        tasks.get(existing.id, author.householdId) shouldBe existing
    }

    @Test
    fun `unknown and foreign assignees leave the stored task unchanged`() {
        // given
        val existing = tasks.save(task())

        // then
        shouldThrow<InvalidTask> { service.assignTo(author, existing.id, outsider.id) }
        tasks.get(existing.id, author.householdId) shouldBe existing
    }

    @Test
    fun `complete saves a completed task and list filters incomplete tasks`() {
        // given
        val existing = tasks.save(task())
        val other = tasks.save(task(title = "Other"))

        // when
        val completed = service.complete(partner, existing.id)

        // then
        completed.completed.shouldBeTrue()
        tasks.get(existing.id, author.householdId) shouldBe completed
        service.list(TaskFilter(author.householdId, completed = false)) shouldBe listOf(other)
    }

    @Test
    fun `reopen saves an incomplete task`() {
        // given
        val existing = tasks.save(task().complete())

        // when
        val reopened = service.reopen(author, existing.id)

        // then
        reopened.completed.shouldBeFalse()
        tasks.get(existing.id, author.householdId) shouldBe reopened
    }

    @Test
    fun `archive retains the task and hides it from the default list`() {
        // given
        val existing = tasks.save(task().complete())

        // when
        val archived = service.archive(author, existing.id)

        // then
        archived shouldBe existing.archive(now)
        tasks.get(existing.id, author.householdId) shouldBe archived
        service.list(TaskFilter(author.householdId)).shouldBeEmpty()
        service.list(TaskFilter(author.householdId, archived = true)) shouldBe listOf(archived)
    }

    @Test
    fun `missing and foreign tasks cannot be read or changed`() {
        // given
        val existing = tasks.save(task())
        val id = existing.id

        // then
        shouldThrow<TaskNotFound> { service.get(author, randomTaskId()) }
        shouldThrow<TaskNotFound> { service.get(outsider, id) }
        shouldThrow<TaskNotFound> { service.update(outsider, id, UpdateTask(title = "Changed")) }
        shouldThrow<TaskNotFound> { service.assignTo(outsider, id, outsider.id) }
        shouldThrow<TaskNotFound> { service.unassign(outsider, id) }
        shouldThrow<TaskNotFound> { service.complete(outsider, id) }
        shouldThrow<TaskNotFound> { service.reopen(outsider, id) }
        shouldThrow<TaskNotFound> { service.archive(outsider, id) }
        tasks.get(id, author.householdId) shouldBe existing
    }
}
