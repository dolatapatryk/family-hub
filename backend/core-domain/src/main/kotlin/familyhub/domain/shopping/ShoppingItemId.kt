package familyhub.domain.shopping

import java.util.UUID
import java.util.UUID.randomUUID

@JvmInline
value class ShoppingItemId(val id: UUID) {

    override fun toString(): String = id.toString()

    companion object {
        fun randomShoppingItemId(): ShoppingItemId = ShoppingItemId(randomUUID())
    }
}
