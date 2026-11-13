package com.patrykdolata.familyhub.shoppinglist.domain;

import static java.util.Objects.requireNonNull;

public class ShoppingItemNotFound extends RuntimeException {

	public ShoppingItemNotFound(ShoppingItemId id) {
		super("Shopping item not found: " + requireNonNull(id, "id").value());
	}
}
