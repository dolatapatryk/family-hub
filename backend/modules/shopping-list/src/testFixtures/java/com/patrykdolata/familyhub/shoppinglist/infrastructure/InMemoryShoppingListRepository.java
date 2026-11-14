package com.patrykdolata.familyhub.shoppinglist.infrastructure;

import com.patrykdolata.familyhub.common.HouseholdId;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListFilter;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryShoppingListRepository implements ShoppingListRepository {

    private final Map<ShoppingItemId, ShoppingItem> items = new ConcurrentHashMap<>();

    @Override
    public Optional<ShoppingItem> find(ShoppingItemId id, HouseholdId householdId) {
        return Optional.ofNullable(items.get(id))
            .filter(item -> item.householdId().equals(householdId));
    }

    @Override
    public List<ShoppingItem> list(ShoppingListFilter filter) {
        return items.values().stream()
            .filter(item -> item.householdId().equals(filter.householdId()))
            .filter(item -> item.completed() == filter.completed())
            .toList();
    }

    @Override
    public ShoppingItem save(ShoppingItem item) {
        items.put(item.id(), item);
        return item;
    }

    @Override
    public void delete(ShoppingItemId id, HouseholdId householdId) {
        find(id, householdId).ifPresent(_ -> items.remove(id));
    }

    @Override
    public int deleteCompleted(HouseholdId householdId) {
        int deletedCount = (int) items.values().stream()
            .filter(ShoppingItem::completed)
            .filter(item -> item.householdId().equals(householdId))
            .count();
        items.entrySet().removeIf(entry -> {
            ShoppingItem item = entry.getValue();
            return item.completed() && item.householdId().equals(householdId);
        });
        return deletedCount;
    }
}
