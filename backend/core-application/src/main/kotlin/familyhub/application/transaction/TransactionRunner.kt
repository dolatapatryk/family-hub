package familyhub.application.transaction

/** Keeps loading, applying a domain operation, and saving in one transaction. */
interface TransactionRunner {
    fun <T> execute(block: () -> T): T
}
