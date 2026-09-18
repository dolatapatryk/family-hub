package familyhub.application.transaction

interface TransactionRunner {
    fun <T> execute(block: () -> T): T
}
