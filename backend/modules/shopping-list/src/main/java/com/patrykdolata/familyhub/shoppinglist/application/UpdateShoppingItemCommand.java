package com.patrykdolata.familyhub.shoppinglist.application;

import com.patrykdolata.familyhub.common.FieldChange;

import java.util.Optional;

import static java.util.Objects.requireNonNull;

public record UpdateShoppingItemCommand(
        FieldChange<String> name,
        FieldChange<Optional<String>> quantity,
        FieldChange<Optional<String>> store,
        FieldChange<Boolean> completed
) {

    public UpdateShoppingItemCommand {
        requireNonNull(name, "name");
        requireNonNull(quantity, "quantity");
        requireNonNull(store, "store");
        requireNonNull(completed, "completed");
    }
}
