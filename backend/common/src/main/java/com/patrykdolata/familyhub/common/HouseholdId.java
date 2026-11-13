package com.patrykdolata.familyhub.common;

import java.util.UUID;

import static java.util.Objects.requireNonNull;

public record HouseholdId(UUID value) {

    public HouseholdId {
        requireNonNull(value, "value");
    }
}
