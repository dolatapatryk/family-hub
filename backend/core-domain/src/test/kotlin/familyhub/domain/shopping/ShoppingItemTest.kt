package familyhub.domain.shopping

import familyhub.domain.shopping.ShoppingTestData.author
import familyhub.domain.shopping.ShoppingTestData.item
import familyhub.domain.shopping.ShoppingTestData.now
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class ShoppingItemTest {
    @Test
    fun `creates an incomplete item with a trimmed name and creator metadata`() {
        // when
        val created = ShoppingItem.create("  Milk  ", author.householdId, "2", author.id, now)

        // then
        created.name shouldBe "Milk"
        created.quantity shouldBe "2"
        created.householdId shouldBe author.householdId
        created.addedBy shouldBe author.id
        created.createdAt shouldBe now
        created.completed.shouldBeFalse()
    }

    @Test
    fun `blank names are rejected during creation and editing`() {
        // then
        shouldThrow<InvalidShoppingItem> { item(name = " \n ") }
        shouldThrow<InvalidShoppingItem> { item().update(name = " ") }
    }

    @Test
    fun `editing changes only supplied details`() {
        val original = item()
        original.update(name = "  Bread  ") shouldBe original.copy(name = "Bread")
        original.update(quantity = "3") shouldBe original.copy(quantity = "3")
        original.update() shouldBe original
        original.update(quantity = null).quantity.shouldBeNull()
        item(quantity = null).quantity.shouldBeNull()
    }

    @Test
    fun `completion and reopening preserve identity and details`() {
        val original = item()
        val completed = original.update(completed = true)
        completed shouldBe original.copy(completed = true)
        completed.update(completed = true) shouldBe completed
        completed.update(completed = false) shouldBe original
    }
}
