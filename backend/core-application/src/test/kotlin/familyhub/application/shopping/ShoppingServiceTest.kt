package familyhub.application.shopping

import familyhub.application.common.FieldChange.Set
import familyhub.domain.shopping.InvalidShoppingItem
import familyhub.domain.shopping.ShoppingFilter
import familyhub.domain.shopping.ShoppingItemId.Companion.randomShoppingItemId
import familyhub.domain.shopping.ShoppingItemNotFound
import familyhub.domain.shopping.ShoppingTestData.author
import familyhub.domain.shopping.ShoppingTestData.item
import familyhub.domain.shopping.ShoppingTestData.now
import familyhub.domain.shopping.ShoppingTestData.outsider
import familyhub.domain.shopping.ShoppingTestData.partner
import familyhub.testing.DirectTransactionRunner
import familyhub.testing.InMemoryShoppingRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import java.time.Clock.fixed
import java.time.ZoneOffset.UTC

class ShoppingServiceTest {

    private val items = InMemoryShoppingRepository()
    private val service = ShoppingService(items, DirectTransactionRunner(), fixed(now, UTC))

    @Test
    fun `create saves an incomplete item with the caller and clock`() {
        val created = service.create(author, CreateShoppingItem(" Milk ", "2"))

        items.get(created.id, author.householdId) shouldBe created
        created.name shouldBe "Milk"
        created.quantity shouldBe "2"
        created.householdId shouldBe author.householdId
        created.addedBy shouldBe author.id
        created.createdAt shouldBe now
        created.completed.shouldBeFalse()
    }

    @Test
    fun `update preserves omitted fields and can explicitly clear quantity`() {
        val existing = items.save(item().update(completed = true))

        val updated = service.update(partner, existing.id, UpdateShoppingItem(name = "Bread"))

        updated shouldBe existing.copy(name = "Bread")
        items.get(existing.id, author.householdId) shouldBe updated
        service.update(author, existing.id, UpdateShoppingItem()) shouldBe updated
        service.update(author, existing.id, UpdateShoppingItem(quantity = Set(null)))
        items.get(existing.id, author.householdId).quantity.shouldBeNull()
    }

    @Test
    fun `household members can complete and reopen items and filter purchased items`() {
        val existing = items.save(item())
        val other = items.save(item(name = "Bread"))
        service.create(outsider, CreateShoppingItem("Foreign"))

        val completed = service.update(partner, existing.id, UpdateShoppingItem(completed = true))

        completed shouldBe existing.copy(completed = true)
        items.get(existing.id, author.householdId) shouldBe completed
        service.list(ShoppingFilter(author.householdId)) shouldBe listOf(other)
        service.list(ShoppingFilter(author.householdId, completed = false)) shouldBe listOf(other)
        service.list(ShoppingFilter(author.householdId, completed = true)) shouldBe listOf(completed)
        service.update(author, existing.id, UpdateShoppingItem(completed = false)) shouldBe existing
    }

    @Test
    fun `delete removes purchased and unpurchased items for household members`() {
        val existing = items.save(item())
        val completed = items.save(item().update(completed = true))

        service.delete(partner, existing.id)
        service.delete(author, completed.id)

        items.find(existing.id, author.householdId).shouldBeNull()
        items.find(completed.id, author.householdId).shouldBeNull()
    }

    @Test
    fun `invalid names never change stored items`() {
        shouldThrow<InvalidShoppingItem> { service.create(author, CreateShoppingItem(" ")) }
        service.list(ShoppingFilter(author.householdId)).shouldBeEmpty()
        val existing = items.save(item())

        shouldThrow<InvalidShoppingItem> {
            service.update(author, existing.id, UpdateShoppingItem(name = " ", completed = true))
        }
        items.get(existing.id, author.householdId) shouldBe existing
    }

    @Test
    fun `missing and foreign items cannot be changed or deleted`() {
        val existing = items.save(item())
        val missing = randomShoppingItemId()

        shouldThrow<ShoppingItemNotFound> { service.update(author, missing, UpdateShoppingItem(name = "Changed")) }
        shouldThrow<ShoppingItemNotFound> { service.delete(author, missing) }
        shouldThrow<ShoppingItemNotFound> { service.update(outsider, existing.id, UpdateShoppingItem(completed = true)) }
        shouldThrow<ShoppingItemNotFound> { service.delete(outsider, existing.id) }
        items.get(existing.id, author.householdId) shouldBe existing
    }
}
