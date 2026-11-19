package com.patrykdolata.familyhub.shoppinglist.domain;

import java.time.Instant;

import static com.patrykdolata.familyhub.common.HouseholdId.randomHouseholdId;
import static com.patrykdolata.familyhub.common.UserId.randomUserId;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem.shoppingItem;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId.randomShoppingItemId;

public final class ShoppingItemTestData {

    public static final Instant NOW = Instant.parse("2026-11-14T10:15:30Z");

    private ShoppingItemTestData() {
    }

    public static ShoppingItem.Builder aShoppingItem() {
        return shoppingItem()
            .id(randomShoppingItemId())
            .householdId(randomHouseholdId())
            .name("Cheese")
            .quantity("2 pcs")
            .store("Lidl")
            .completed(false)
            .addedBy(randomUserId())
            .createdAt(NOW);
    }
}
