package com.patrykdolata.familyhub.shoppinglist.domain;

import com.patrykdolata.familyhub.common.HouseholdId;

import static java.util.Objects.requireNonNull;

public record ShoppingListFilter(
        HouseholdId householdId,
        boolean completed
) {

    public ShoppingListFilter {
        requireNonNull(householdId, "householdId");
    }
}
