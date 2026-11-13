package com.patrykdolata.familyhub.shoppinglist.application;

import java.util.Optional;

import static java.util.Objects.requireNonNull;

public record CreateShoppingItemCommand(String name, Optional<String> quantity, Optional<String> store) {

	public CreateShoppingItemCommand {
		requireNonNull(name, "name");
	}
}
