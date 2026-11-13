package com.patrykdolata.familyhub.common;

import static java.util.Objects.requireNonNull;

public record CurrentMember(UserId userId, HouseholdId householdId) {

    public CurrentMember {
        requireNonNull(userId, "userId");
        requireNonNull(householdId, "householdId");
    }
}
