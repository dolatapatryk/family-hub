package com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq;

import com.patrykdolata.familyhub.common.HouseholdId;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListFilter;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListRepository;
import org.jooq.DSLContext;
import org.jooq.Record;

import java.util.List;
import java.util.Optional;

import static com.patrykdolata.familyhub.common.HouseholdId.householdId;
import static com.patrykdolata.familyhub.common.Optionals.optional;
import static com.patrykdolata.familyhub.common.UserId.userId;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem.shoppingItem;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId.shoppingItemId;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.ADDED_BY;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.COMPLETED;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.CREATED_AT;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.HOUSEHOLD_ID;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.ID;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.NAME;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.QUANTITY;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.SHOPPING_ITEMS;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.SHOPPING_ITEMS_HOUSEHOLD_ID;
import static com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq.JooqShoppingList.STORE;
import static java.time.ZoneOffset.UTC;
import static java.util.Objects.requireNonNull;

public final class JooqShoppingListRepository implements ShoppingListRepository {

    private final DSLContext dsl;

    public JooqShoppingListRepository(DSLContext dsl) {
        this.dsl = requireNonNull(dsl, "dsl");
    }

    @Override
    public Optional<ShoppingItem> find(ShoppingItemId id, HouseholdId householdId) {
        var record = dsl.select()
            .from(SHOPPING_ITEMS)
            .where(ID.eq(id.value()))
            .and(HOUSEHOLD_ID.eq(householdId.value()))
            .fetchOne();

        return optional(record)
            .map(JooqShoppingListRepository::toShoppingItem);
    }

    @Override
    public List<ShoppingItem> list(ShoppingListFilter filter) {
        return dsl.select()
            .from(SHOPPING_ITEMS)
            .where(HOUSEHOLD_ID.eq(filter.householdId().value()))
            .and(COMPLETED.eq(filter.completed()))
            .orderBy(CREATED_AT.asc(), ID.asc())
            .fetch(JooqShoppingListRepository::toShoppingItem);
    }

    @Override
    public ShoppingItem save(ShoppingItem item) {
        var result = dsl.insertInto(SHOPPING_ITEMS, ID, HOUSEHOLD_ID, NAME, QUANTITY, STORE, COMPLETED, ADDED_BY, CREATED_AT)
            .values(
                item.id().value(),
                item.householdId().value(),
                item.name(),
                item.quantity().orElse(null),
                item.store().orElse(null),
                item.completed(),
                item.addedBy().value(),
                item.createdAt().atOffset(UTC)
            )
            .onConflict(ID)
            .doUpdate()
            .set(NAME, item.name())
            .set(QUANTITY, item.quantity().orElse(null))
            .set(STORE, item.store().orElse(null))
            .set(COMPLETED, item.completed())
            .where(SHOPPING_ITEMS_HOUSEHOLD_ID.eq(item.householdId().value()))
            .execute();
        if (result < 1) {
            throw new IllegalStateException("Shopping item was not persisted: " + item.id());
        }
        return item;
    }

    @Override
    public void delete(ShoppingItemId id, HouseholdId householdId) {
        dsl.deleteFrom(SHOPPING_ITEMS)
            .where(ID.eq(id.value()))
            .and(HOUSEHOLD_ID.eq(householdId.value()))
            .execute();
    }

    @Override
    public int deleteCompleted(HouseholdId householdId) {
        return dsl.deleteFrom(SHOPPING_ITEMS)
            .where(HOUSEHOLD_ID.eq(householdId.value()))
            .and(COMPLETED.isTrue())
            .execute();
    }

    private static ShoppingItem toShoppingItem(Record record) {
        return shoppingItem()
            .id(shoppingItemId(record.get(ID)))
            .householdId(householdId(record.get(HOUSEHOLD_ID)))
            .name(record.get(NAME))
            .quantity(optional(record.get(QUANTITY)))
            .store(optional(record.get(STORE)))
            .completed(record.get(COMPLETED))
            .addedBy(userId(record.get(ADDED_BY)))
            .createdAt(record.get(CREATED_AT).toInstant())
            .build();
    }
}
