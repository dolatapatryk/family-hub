package com.patrykdolata.familyhub.shoppinglist.domain;

import static java.util.Objects.requireNonNull;

public class InvalidShoppingItem extends IllegalArgumentException {

    public InvalidShoppingItem(String message) {
        super(requireNonNull(message, "message"));
    }
}
