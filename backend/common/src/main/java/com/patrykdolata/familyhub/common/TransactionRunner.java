package com.patrykdolata.familyhub.common;

import java.util.function.Supplier;

@FunctionalInterface
public interface TransactionRunner {

	<T> T execute(Supplier<T> operation);
}
