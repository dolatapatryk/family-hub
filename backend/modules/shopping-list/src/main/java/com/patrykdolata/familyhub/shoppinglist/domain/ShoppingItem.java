package com.patrykdolata.familyhub.shoppinglist.domain;

import com.patrykdolata.familyhub.common.HouseholdId;
import com.patrykdolata.familyhub.common.UserId;

import java.time.Instant;
import java.util.Optional;

import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId.randomShoppingItemId;
import static java.util.Objects.requireNonNull;
import static java.util.Optional.empty;

public record ShoppingItem(
    ShoppingItemId id,
    HouseholdId householdId,
    String name,
    Optional<String> quantity,
    Optional<String> store,
    boolean completed,
    UserId addedBy,
    Instant createdAt
) {

    public ShoppingItem {
        requireNonNull(id, "id");
        requireNonNull(householdId, "householdId");
        name = normalizeName(requireNonNull(name, "name"));
        quantity = normalizeOptionalText(quantity);
        store = normalizeOptionalText(store);
        requireNonNull(addedBy, "addedBy");
        requireNonNull(createdAt, "createdAt");
    }

    public static Builder shoppingItem() {
        return new Builder();
    }

    public ShoppingItem update(String name, Optional<String> quantity, Optional<String> store) {
        return copy()
            .name(name)
            .quantity(quantity)
            .store(store)
            .build();
    }

    public ShoppingItem complete() {
        if (completed) {
            return this;
        }
        return copy()
            .completed(true)
            .build();
    }

    public ShoppingItem reopen() {
        if (!completed) {
            return this;
        }
        return copy()
            .completed(false)
            .build();
    }

    public ShoppingItem.Builder copy() {
        return shoppingItem()
            .id(id)
            .householdId(householdId)
            .name(name)
            .quantity(quantity)
            .store(store)
            .completed(completed)
            .addedBy(addedBy)
            .createdAt(createdAt);
    }

    private static String normalizeName(String value) {
        String normalized = value.trim();
        if (normalized.isBlank()) {
            throw new InvalidShoppingItem("name must not be blank");
        }
        return normalized;
    }

    private static Optional<String> normalizeOptionalText(Optional<String> value) {
        return value.map(String::trim).filter(text -> !text.isEmpty());
    }

    public static final class Builder {
        private ShoppingItemId id = randomShoppingItemId();
        private HouseholdId householdId;
        private String name;
        private Optional<String> quantity = empty();
        private Optional<String> store = empty();
        private boolean completed;
        private UserId addedBy;
        private Instant createdAt;

        private Builder() {
        }

        public Builder id(ShoppingItemId id) {
            this.id = id;
            return this;
        }

        public Builder householdId(HouseholdId householdId) {
            this.householdId = householdId;
            return this;
        }

        public Builder name(String name) {
            this.name = name;
            return this;
        }

        public Builder quantity(Optional<String> quantity) {
            this.quantity = quantity;
            return this;
        }

        public Builder quantity(String quantity) {
            this.quantity = Optional.of(quantity);
            return this;
        }

        public Builder store(Optional<String> store) {
            this.store = store;
            return this;
        }

        public Builder store(String store) {
            this.store = Optional.of(store);
            return this;
        }

        public Builder completed(boolean completed) {
            this.completed = completed;
            return this;
        }

        public Builder addedBy(UserId addedBy) {
            this.addedBy = addedBy;
            return this;
        }

        public Builder createdAt(Instant createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public ShoppingItem build() {
            return new ShoppingItem(id, householdId, name, quantity, store, completed, addedBy, createdAt);
        }
    }
}
