package com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq;

import org.jooq.Field;
import org.jooq.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

final class JooqShoppingList {

    private JooqShoppingList() {
    }

    static final Table<?> SHOPPING_ITEMS = table(name("public", "shopping_items"));

    static final Field<UUID> ID = field(name("id"), UUID.class);
    static final Field<UUID> HOUSEHOLD_ID = field(name("household_id"), UUID.class);
    // Qualify the target row in ON CONFLICT conditions to distinguish it from EXCLUDED.
    static final Field<UUID> SHOPPING_ITEMS_HOUSEHOLD_ID = field(name("shopping_items", "household_id"), UUID.class);
    static final Field<String> NAME = field(name("name"), String.class);
    static final Field<String> QUANTITY = field(name("quantity"), String.class);
    static final Field<String> STORE = field(name("store"), String.class);
    static final Field<Boolean> COMPLETED = field(name("completed"), Boolean.class);
    static final Field<UUID> ADDED_BY = field(name("added_by"), UUID.class);
    static final Field<OffsetDateTime> CREATED_AT = field(name("created_at"), OffsetDateTime.class);
}
