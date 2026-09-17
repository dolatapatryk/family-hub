package familyhub.testing

import familyhub.application.transaction.TransactionRunner

/** Unit-test substitute; rollback behavior is covered by the SQLite integration specs. */
class DirectTransactionRunner : TransactionRunner {
    override fun <T> execute(block: () -> T): T = block()
}
