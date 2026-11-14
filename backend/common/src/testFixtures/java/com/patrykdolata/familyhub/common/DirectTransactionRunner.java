package com.patrykdolata.familyhub.common;

import java.util.function.Supplier;

public final class DirectTransactionRunner implements TransactionRunner {

    @Override
    public <T> T execute(Supplier<T> operation) {
        return operation.get();
    }
}
