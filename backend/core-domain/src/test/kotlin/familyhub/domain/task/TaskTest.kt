package familyhub.domain.task

import familyhub.domain.task.TaskTestData.author
import familyhub.domain.task.TaskTestData.now
import familyhub.domain.task.TaskTestData.partner
import familyhub.domain.task.TaskTestData.task
import familyhub.domain.task.TaskTestData.today
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeSameInstanceAs
import org.junit.jupiter.api.Test

class TaskTest {
    @Test
    fun `creates an incomplete shared task in the creator's household`() {
        val task = Task.create("  Call doctor  ", today, author.householdId, author.id, now)

        task.title shouldBe "Call doctor"
        task.householdId shouldBe author.householdId
        task.createdBy shouldBe author.id
        task.createdAt shouldBe now
        task.dueDate shouldBe today
        task.completed.shouldBeFalse()
        task.assignedTo.shouldBeNull()
        task.archivedAt.shouldBeNull()
    }

    @Test
    fun `blank titles are rejected on creation and update`() {
        shouldThrow<InvalidTask> { Task.create(" \n ", today, author.householdId, author.id, now) }
        shouldThrow<InvalidTask> { task().update(title = " ") }
    }

    @Test
    fun `update changes only title and due date`() {
        val original = task().assignTo(partner.id).complete()

        val updated = original.update(title = "  Dentist  ", dueDate = today.plusDays(1))

        updated shouldBe original.copy(title = "Dentist", dueDate = today.plusDays(1))
        original.title shouldBe "Call doctor"
    }

    @Test
    fun `omitted due date is preserved and explicit null clears it`() {
        val original = task()

        original.update(title = "Dentist").dueDate shouldBe today
        original.update(dueDate = null).dueDate.shouldBeNull()
    }

    @Test
    fun `assignment stores a user ID and can be cleared`() {
        val original = task()

        val assigned = original.assignTo(partner.id)

        assigned shouldBe original.copy(assignedTo = partner.id)
        assigned.unassign() shouldBe original
    }

    @Test
    fun `completion preserves task details and is idempotent`() {
        val original = task().assignTo(partner.id)

        val completed = original.complete()

        completed shouldBe original.copy(completed = true)
        completed.complete() shouldBeSameInstanceAs completed
        original.completed.shouldBeFalse()
    }

    @Test
    fun `reopening makes a completed task incomplete`() {
        val completed = task().complete()

        val reopened = completed.reopen()

        reopened.completed.shouldBeFalse()
        reopened.reopen() shouldBeSameInstanceAs reopened
    }

    @Test
    fun `archive preserves task history and the original archive time`() {
        val original = task().assignTo(partner.id).complete()

        val archived = original.archive(now)

        archived shouldBe original.copy(archivedAt = now)
        archived.archive(now.plusSeconds(60)) shouldBeSameInstanceAs archived
        archived.completed.shouldBeTrue()
    }

    @Test
    fun `archived tasks cannot be edited assigned completed or reopened`() {
        val archived = task().archive(now)

        shouldThrow<TaskArchived> { archived.update(title = "Changed") }
        shouldThrow<TaskArchived> { archived.assignTo(partner.id) }
        shouldThrow<TaskArchived> { archived.unassign() }
        shouldThrow<TaskArchived> { archived.complete() }
        shouldThrow<TaskArchived> { archived.reopen() }
    }
}
