package com.patrykdolata.familyhub.shoppinglist.domain;

import java.util.UUID;

import static java.util.Objects.requireNonNull;
import static java.util.UUID.randomUUID;

public record ShoppingItemId(UUID value) {

	public ShoppingItemId {
        requireNonNull(value, "value");
    }

	public static ShoppingItemId randomShoppingItemId() {
		return new ShoppingItemId(randomUUID());
	}
}
