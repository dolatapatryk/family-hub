# Shopping list module

The module owns its shopping-list domain and application use cases. Its
`ShoppingListRepository` port lives in `domain`; persistence implementations
belong under `infrastructure`. The REST layer maps HTTP contracts to application
commands and does not contain business rules.

`CurrentMember` is supplied by the application security boundary. The module
uses its household and user IDs to scope data access and set `addedBy`.

The jOOQ package is the planned adapter for the existing `shopping_items`
schema. Its database connection and authenticated-member integration will be
wired when those application boundaries are configured.
