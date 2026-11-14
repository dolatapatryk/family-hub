package com.patrykdolata.familyhub.common;

import java.util.UUID;

import static java.util.Objects.requireNonNull;
import static java.util.UUID.randomUUID;

public record UserId(UUID value) {

    public UserId {
        requireNonNull(value, "value");
    }

    public static UserId userId(UUID value) {
        return new UserId(value);
    }

    public static UserId userId(String value) {
        return new UserId(UUID.fromString(value));
    }

    public static UserId randomUserId() {
        return new UserId(randomUUID());
    }
}
