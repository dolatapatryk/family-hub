package com.patrykdolata.familyhub.common;

import java.util.UUID;

import static java.util.Objects.requireNonNull;

public record UserId(UUID value) {

    public UserId {
        requireNonNull(value, "value");
    }
}
