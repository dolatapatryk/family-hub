package familyhub.domain.shopping

class InvalidShoppingItem(message: String) : RuntimeException(message)
class ShoppingItemNotFound : RuntimeException("Shopping item not found")
