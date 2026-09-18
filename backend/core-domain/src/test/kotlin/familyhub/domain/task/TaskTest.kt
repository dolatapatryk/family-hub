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
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeSameInstanceAs
import org.junit.jupiter.api.Test

class TaskTest {

    @Test
    fun `creates an incomplete shared task in the creator's household`() {
        // when
        val task = Task.create("  Call doctor  ", author.householdId, today, author.id, now)

        // then
        task.id.shouldNotBeNull()
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
    fun `throws on blank title`() {
        // then
        val ex = shouldThrow<InvalidTask> {
            Task.create(" \n ", author.householdId, today, author.id, now)
        }
        ex.message shouldBe "title must not be blank"
    }

    @Test
    fun `update changes only title and due date`() {
        // given
        val original = task().assignTo(partner.id).complete()

        // when
        val updated = original.update(title = "  Dentist  ", dueDate = today.plusDays(1))

        // then
        updated shouldBe original.copy(title = "Dentist", dueDate = today.plusDays(1))
    }

    @Test
    fun `omitted due date is preserved and explicit null clears it`() {
        // given
        val original = task()

        // then
        original.update(title = "Dentist").dueDate shouldBe today
        original.update(dueDate = null).dueDate.shouldBeNull()
    }

    @Test
    fun `assignment stores a user ID and can be cleared`() {
        // given
        val original = task()

        // when
        val assigned = original.assignTo(partner.id)

        // then
        assigned shouldBe original.copy(assignedTo = partner.id)
        assigned.unassign() shouldBe original
    }

    @Test
    fun `completion preserves task details and is idempotent`() {
        // given
        val original = task().assignTo(partner.id)

        // when
        val completed = original.complete()

        // then
        completed shouldBe original.copy(completed = true)
        completed.complete() shouldBeSameInstanceAs completed
    }

    @Test
    fun `reopening makes a completed task incomplete`() {
        // given
        val completed = task().complete()

        // when
        val reopened = completed.reopen()

        // then
        reopened.completed.shouldBeFalse()
        reopened.reopen() shouldBeSameInstanceAs reopened
    }

    @Test
    fun `archive preserves task history and the original archive time`() {
        // given
        val original = task().assignTo(partner.id).complete()

        // when
        val archived = original.archive(now)

        archived shouldBe original.copy(archivedAt = now)
        archived.archive(now.plusSeconds(60)) shouldBeSameInstanceAs archived
        archived.completed.shouldBeTrue()
    }

    @Test
    fun `archived tasks cannot be edited assigned completed or reopened`() {
        // given
        val archived = task().archive(now)

        // then
        shouldThrow<TaskArchived> { archived.update(title = "Changed") }
        shouldThrow<TaskArchived> { archived.assignTo(partner.id) }
        shouldThrow<TaskArchived> { archived.unassign() }
        shouldThrow<TaskArchived> { archived.complete() }
        shouldThrow<TaskArchived> { archived.reopen() }
    }
}
