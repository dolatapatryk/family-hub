package familyhub.infrastructure.persistence

import familyhub.application.transaction.TransactionRunner
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.transactions.transaction

class ExposedTransactionRunner(private val database: Database) : TransactionRunner {

    override fun <T> execute(block: () -> T): T = transaction(database) { block() }
}
