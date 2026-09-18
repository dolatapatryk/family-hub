package familyhub.domain.task

import familyhub.domain.task.TaskTestData.householdId
import familyhub.domain.task.TaskTestData.today
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class TaskFilterTest {

    @Test
    fun `filter rejects reversed date bounds at construction`() {
        // then
        val ex = shouldThrow<InvalidTaskFilter> {
            TaskFilter(householdId = householdId, from = today, to = today.minusDays(1))
        }
        ex.message shouldBe "from must be on or before to"
    }
}
