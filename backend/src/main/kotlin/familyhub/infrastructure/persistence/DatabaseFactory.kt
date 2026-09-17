package familyhub.infrastructure.persistence

import org.flywaydb.core.Flyway
import org.jetbrains.exposed.sql.Database
import java.sql.Connection

class DatabaseFactory(private val settings: DatabaseSettings) {
    private var database: Database? = null

    @Synchronized
    fun initialize(): Database {
        database?.let { return it }
        settings.ensureParentDirectory()

        Flyway.configure()
            .dataSource(settings.jdbcUrl, "", "")
            .locations("classpath:db/migration")
            .load()
            .migrate()

        return Database.connect(
            url = settings.jdbcUrl,
            driver = "org.sqlite.JDBC",
            setupConnection = { connection ->
                connection.createStatement().use { statement ->
                    statement.execute("PRAGMA foreign_keys = ON")
                }
                connection.transactionIsolation = Connection.TRANSACTION_SERIALIZABLE
            },
        ).also { database = it }
    }
}
