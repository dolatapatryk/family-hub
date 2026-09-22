package familyhub.infrastructure.persistence

import familyhub.domain.shopping.ShoppingFilter
import familyhub.domain.shopping.ShoppingItemId
import familyhub.domain.shopping.ShoppingItemId.Companion.randomShoppingItemId
import familyhub.domain.shopping.ShoppingItemNotFound
import familyhub.domain.shopping.ShoppingTestData.author
import familyhub.domain.shopping.ShoppingTestData.item
import familyhub.domain.shopping.ShoppingTestData.now
import familyhub.domain.shopping.ShoppingTestData.outsider
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.UUID

class ExposedShoppingRepositorySpec {

    @TempDir
    lateinit var directory: Path
    private lateinit var settings: DatabaseSettings
    private lateinit var items: ExposedShoppingRepository
    private lateinit var transactions: ExposedTransactionRunner

    @BeforeEach
    fun setUp() {
        settings = DatabaseSettings(directory.resolve("family.db").toString())
        val database = DatabaseFactory(settings).initialize()
        items = ExposedShoppingRepository(database)
        transactions = ExposedTransactionRunner(database)
    }

    @Test
    fun `save inserts and updates the same item and survives database reinitialization`() {
        val original = items.save(item())
        val updated = original.update(name = "Bread", quantity = null, completed = true)
        items.save(updated)

        val reopened = ExposedShoppingRepository(DatabaseFactory(settings).initialize())
        reopened.get(original.id, author.householdId) shouldBe updated
        reopened.list(ShoppingFilter(author.householdId)).shouldBeEmpty()
        reopened.list(ShoppingFilter(author.householdId, completed = true)) shouldBe listOf(updated)
    }

    @Test
    fun `list filters completion and household and orders by creation time then ID`() {
        val first = item().copy(id = ShoppingItemId(UUID.fromString("00000000-0000-0000-0000-000000000001")))
        val second = item().copy(id = ShoppingItemId(UUID.fromString("00000000-0000-0000-0000-000000000002")))
        val later = item().copy(createdAt = now.plusSeconds(1))
        val completed = item().update(completed = true)
        items.save(later)
        items.save(second)
        items.save(first)
        items.save(completed)
        items.save(item().copy(householdId = outsider.householdId, addedBy = outsider.id))

        items.list(ShoppingFilter(author.householdId)) shouldBe listOf(first, second, later)
        items.list(ShoppingFilter(author.householdId, completed = true)) shouldBe listOf(completed)
    }

    @Test
    fun `find get and delete respect household scope`() {
        val existing = items.save(item())

        items.find(existing.id, outsider.householdId).shouldBeNull()
        items.find(randomShoppingItemId(), author.householdId).shouldBeNull()
        shouldThrow<ShoppingItemNotFound> { items.get(existing.id, outsider.householdId) }
        shouldThrow<ShoppingItemNotFound> { items.get(randomShoppingItemId(), author.householdId) }
        items.list(ShoppingFilter(outsider.householdId)).shouldBeEmpty()
        items.delete(existing.id, outsider.householdId)
        items.get(existing.id, author.householdId) shouldBe existing
        items.delete(existing.id, author.householdId)
        items.find(existing.id, author.householdId).shouldBeNull()
    }

    @Test
    fun `failed transactions roll back inserts updates and deletes`() {
        val existing = items.save(item())
        val deleted = items.save(item(name = "Bread"))
        val inserted = item(name = "Eggs")

        shouldThrow<IllegalStateException> {
            transactions.execute {
                items.save(existing.update(completed = true))
                items.delete(deleted.id, author.householdId)
                items.save(inserted)
                error("Rollback")
            }
        }

        items.get(existing.id, author.householdId) shouldBe existing
        items.get(deleted.id, author.householdId) shouldBe deleted
        items.find(inserted.id, author.householdId).shouldBeNull()
    }
}
