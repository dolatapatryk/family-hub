package familyhub.infrastructure.persistence

import familyhub.domain.household.HouseholdId
import familyhub.domain.shopping.ShoppingFilter
import familyhub.domain.shopping.ShoppingItem
import familyhub.domain.shopping.ShoppingItemId
import familyhub.domain.shopping.ShoppingRepository
import familyhub.domain.user.UserId
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder.ASC
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.upsert
import java.time.Instant
import java.util.UUID

internal object ShoppingItems : Table("shopping_items") {
    val id = text("id")
    val householdId = text("household_id")
    val name = text("name")
    val quantity = text("quantity").nullable()
    val store = text("store").nullable()
    val completed = bool("completed")
    val addedBy = text("added_by")
    val createdAt = text("created_at")
    override val primaryKey = PrimaryKey(id)
}

class ExposedShoppingRepository(private val database: Database) : ShoppingRepository {

    override fun find(id: ShoppingItemId, householdId: HouseholdId): ShoppingItem? = transaction(database) {
        ShoppingItems.selectAll()
            .where { (ShoppingItems.householdId eq householdId.toString()) and (ShoppingItems.id eq id.toString()) }
            .singleOrNull()
            ?.toShoppingItem()
    }

    override fun list(filter: ShoppingFilter): List<ShoppingItem> = transaction(database) {
        ShoppingItems.selectAll()
            .where {
                (ShoppingItems.householdId eq filter.householdId.toString()) and
                    (ShoppingItems.completed eq filter.completed)
            }
            .orderBy(ShoppingItems.createdAt to ASC, ShoppingItems.id to ASC)
            .map { it.toShoppingItem() }
    }

    override fun save(item: ShoppingItem): ShoppingItem = transaction(database) {
        ShoppingItems.upsert {
            it[id] = item.id.toString()
            it[householdId] = item.householdId.toString()
            it[name] = item.name
            it[quantity] = item.quantity
            it[store] = item.store
            it[completed] = item.completed
            it[addedBy] = item.addedBy.toString()
            it[createdAt] = item.createdAt.toString()
        }
        item
    }

    override fun delete(id: ShoppingItemId, householdId: HouseholdId) {
        transaction(database) {
            ShoppingItems.deleteWhere {
                (ShoppingItems.id eq id.toString()) and (ShoppingItems.householdId eq householdId.toString())
            }
        }
    }

    private fun ResultRow.toShoppingItem(): ShoppingItem = ShoppingItem(
        id = ShoppingItemId(UUID.fromString(this[ShoppingItems.id])),
        householdId = HouseholdId(UUID.fromString(this[ShoppingItems.householdId])),
        name = this[ShoppingItems.name],
        quantity = this[ShoppingItems.quantity],
        store = this[ShoppingItems.store],
        completed = this[ShoppingItems.completed],
        addedBy = UserId(UUID.fromString(this[ShoppingItems.addedBy])),
        createdAt = Instant.parse(this[ShoppingItems.createdAt]),
    )
}
