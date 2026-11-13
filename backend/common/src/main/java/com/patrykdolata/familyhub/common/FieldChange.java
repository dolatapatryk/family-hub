package com.patrykdolata.familyhub.common;

import static java.util.Objects.requireNonNull;

public sealed interface FieldChange<T> permits FieldChange.Unchanged, FieldChange.SetValue {

	T applyTo(T currentValue);

	record Unchanged<T>() implements FieldChange<T> {
		@Override
		public T applyTo(T currentValue) {
			return currentValue;
		}
	}

	record SetValue<T>(T value) implements FieldChange<T> {
		public SetValue {
            requireNonNull(value, "value");
        }

		@Override
		public T applyTo(T currentValue) {
			return value;
		}
	}
}
