package familyhub.domain.task

import familyhub.domain.task.TaskTestData.householdId
import familyhub.domain.task.TaskTestData.today
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class TaskFilterTest {
    @Test
    fun `filter rejects reversed date bounds at construction`() {
        shouldThrow<InvalidTaskFilter> {
            TaskFilter(householdId = householdId, from = today, to = today.minusDays(1))
        }
    }

    @Test
    fun `filter accepts equal bounds and open ended ranges`() {
        TaskFilter(householdId, from = today, to = today).from shouldBe today
        TaskFilter(householdId, from = today).from shouldBe today
        TaskFilter(householdId, to = today).to shouldBe today
    }

    @Test
    fun `filter includes a household and defaults to non archived tasks`() {
        val filter = TaskFilter(householdId)

        filter.householdId shouldBe householdId
        filter.archived.shouldBeFalse()
    }
}
