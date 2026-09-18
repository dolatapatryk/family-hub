package familyhub.testing

import familyhub.application.transaction.TransactionRunner

class DirectTransactionRunner : TransactionRunner {
    override fun <T> execute(block: () -> T): T = block()
}
