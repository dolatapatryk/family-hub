package familyhub.application.shopping

import familyhub.application.common.orElse
import familyhub.application.transaction.TransactionRunner
import familyhub.domain.shopping.ShoppingFilter
import familyhub.domain.shopping.ShoppingItem
import familyhub.domain.shopping.ShoppingItemId
import familyhub.domain.shopping.ShoppingRepository
import familyhub.domain.user.User
import java.time.Clock
import java.time.Clock.systemUTC
import java.time.Instant.now

class ShoppingService(
    private val items: ShoppingRepository,
    private val transactions: TransactionRunner,
    private val clock: Clock = systemUTC(),
) {

    fun list(filter: ShoppingFilter): List<ShoppingItem> = items.list(filter)

    fun create(user: User, command: CreateShoppingItem): ShoppingItem = items.save(
        ShoppingItem.create(
            name = command.name,
            householdId = user.householdId,
            quantity = command.quantity,
            addedBy = user.id,
            now = now(clock),
            store = command.store,
        )
    )

    fun update(user: User, id: ShoppingItemId, command: UpdateShoppingItem): ShoppingItem = transactions.execute {
        val item = items.get(id, user.householdId)
        val updated = item.update(
            name = command.name ?: item.name,
            quantity = command.quantity.orElse(item.quantity),
            store = command.store.orElse(item.store),
            completed = command.completed ?: item.completed,
        )
        items.save(updated)
    }

    fun delete(user: User, id: ShoppingItemId): Unit = transactions.execute {
        items.get(id, user.householdId)
        items.delete(id, user.householdId)
    }
}
