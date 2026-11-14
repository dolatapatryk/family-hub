package com.patrykdolata.familyhub.shoppinglist.domain;

import com.patrykdolata.familyhub.common.HouseholdId;

import java.util.List;
import java.util.Optional;

public interface ShoppingListRepository {

    Optional<ShoppingItem> find(ShoppingItemId id, HouseholdId householdId);

    default ShoppingItem get(ShoppingItemId id, HouseholdId householdId) {
        return find(id, householdId).orElseThrow(() -> new ShoppingItemNotFound(id));
    }

    List<ShoppingItem> list(ShoppingListFilter filter);

    ShoppingItem save(ShoppingItem item);

    void delete(ShoppingItemId id, HouseholdId householdId);

    int deleteCompleted(HouseholdId householdId);
}
