package com.patrykdolata.familyhub.common;

import java.util.Optional;

import static java.util.Optional.empty;

public final class Optionals {

    private Optionals() {
    }

    public static <T> Optional<T> optional(T value) {
        return value == null ? empty() : Optional.ofNullable(value);
    }

    public static <T> Optional<T> some(T value) {
        return Optional.of(value);
    }
}
