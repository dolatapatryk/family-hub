package familyhub.application.task

import familyhub.domain.task.InvalidTask
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId
import familyhub.domain.task.TaskNotFound
import familyhub.domain.task.TaskTestData.author
import familyhub.domain.task.TaskTestData.now
import familyhub.domain.task.TaskTestData.outsider
import familyhub.domain.task.TaskTestData.partner
import familyhub.domain.task.TaskTestData.task
import familyhub.domain.task.TaskTestData.today
import familyhub.domain.user.UserId
import familyhub.testing.DirectTransactionRunner
import familyhub.testing.InMemoryTaskRepository
import familyhub.testing.InMemoryUserRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.ZoneOffset
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class TaskServiceTest {
    private val tasks = InMemoryTaskRepository()
    private val users = InMemoryUserRepository()
    private val service = TaskService(tasks, users, DirectTransactionRunner(), Clock.fixed(now, ZoneOffset.UTC))

    @BeforeEach
    fun setUp() {
        users.save(author)
        users.save(partner)
        users.save(outsider)
    }

    @Test
    fun `create saves a task with the caller and clock`() {
        val created = service.create(author, CreateTask("Doctor", today))

        tasks.get(author.householdId, created.id) shouldBe created
        created.createdBy shouldBe author.id
        created.createdAt shouldBe now
        created.completed.shouldBeFalse()
    }

    @Test
    fun `get returns a task to another member of the household`() {
        val existing = tasks.save(task())

        service.get(partner, existing.id) shouldBe existing
    }

    @Test
    fun `update saves edited details and preserves omitted due date`() {
        val existing = tasks.save(task().assignTo(partner.id).complete())

        val updated = service.update(author, existing.id, UpdateTask(title = "Dentist"))

        updated shouldBe existing.update(title = "Dentist")
        tasks.get(author.householdId, existing.id) shouldBe updated
    }

    @Test
    fun `update can explicitly clear due date`() {
        val existing = tasks.save(task())

        service.update(author, existing.id, UpdateTask(dueDate = FieldChange.Set(null)))

        tasks.get(author.householdId, existing.id).dueDate.shouldBeNull()
    }

    @Test
    fun `assign resolves the user and saves the assigned task`() {
        val existing = tasks.save(task())

        val assigned = service.assignTo(author, existing.id, partner.id)

        assigned shouldBe existing.assignTo(partner.id)
        tasks.get(author.householdId, existing.id) shouldBe assigned
        service.unassign(author, existing.id)
        tasks.get(author.householdId, existing.id) shouldBe existing
    }

    @Test
    fun `unknown and foreign assignees leave the stored task unchanged`() {
        val existing = tasks.save(task())

        shouldThrow<InvalidTask> { service.assignTo(author, existing.id, UserId.random()) }
        shouldThrow<InvalidTask> { service.assignTo(author, existing.id, outsider.id) }
        tasks.get(author.householdId, existing.id) shouldBe existing
    }

    @Test
    fun `complete saves a completed task and list filters incomplete tasks`() {
        val existing = tasks.save(task())
        val other = tasks.save(task(title = "Other"))

        val completed = service.complete(partner, existing.id)

        completed.completed.shouldBeTrue()
        tasks.get(author.householdId, existing.id) shouldBe completed
        service.list(TaskFilter(author.householdId, completed = false)) shouldBe listOf(other)
    }

    @Test
    fun `reopen saves an incomplete task`() {
        val existing = tasks.save(task().complete())

        val reopened = service.reopen(author, existing.id)

        reopened.completed.shouldBeFalse()
        tasks.get(author.householdId, existing.id) shouldBe reopened
    }

    @Test
    fun `archive retains the task and hides it from the default list`() {
        val existing = tasks.save(task().complete())

        val archived = service.archive(author, existing.id)

        archived shouldBe existing.archive(now)
        tasks.get(author.householdId, existing.id) shouldBe archived
        service.list(TaskFilter(author.householdId)).shouldBeEmpty()
        service.list(TaskFilter(author.householdId, archived = true)) shouldBe listOf(archived)
    }

    @Test
    fun `missing and foreign tasks cannot be read or changed`() {
        val existing = tasks.save(task())
        val id = existing.id

        shouldThrow<TaskNotFound> { service.get(author, TaskId.random()) }
        shouldThrow<TaskNotFound> { service.get(outsider, id) }
        shouldThrow<TaskNotFound> { service.update(outsider, id, UpdateTask(title = "Changed")) }
        shouldThrow<TaskNotFound> { service.assignTo(outsider, id, outsider.id) }
        shouldThrow<TaskNotFound> { service.unassign(outsider, id) }
        shouldThrow<TaskNotFound> { service.complete(outsider, id) }
        shouldThrow<TaskNotFound> { service.reopen(outsider, id) }
        shouldThrow<TaskNotFound> { service.archive(outsider, id) }
        tasks.get(author.householdId, id) shouldBe existing
    }
}
