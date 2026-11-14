package com.patrykdolata.familyhub.common;

import java.util.UUID;

import static java.util.Objects.requireNonNull;
import static java.util.UUID.randomUUID;

public record HouseholdId(UUID value) {

    public HouseholdId {
        requireNonNull(value, "value");
    }

    public static HouseholdId householdId(UUID value) {
        return new HouseholdId(value);
    }

    public static HouseholdId householdId(String value) {
        return new HouseholdId(UUID.fromString(value));
    }

    public static HouseholdId randomHouseholdId() {
        return new HouseholdId(randomUUID());
    }
}
