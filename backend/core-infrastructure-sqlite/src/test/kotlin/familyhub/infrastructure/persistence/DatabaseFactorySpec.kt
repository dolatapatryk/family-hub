package familyhub.infrastructure.persistence

import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class DatabaseFactorySpec {
    @TempDir
    lateinit var directory: Path

    @Test
    fun `initial migrations create schema with archiving and seed the family`() {
        val settings = DatabaseSettings(directory.resolve("family.db").toString())
        val database = DatabaseFactory(settings).initialize()
        transaction(database) { exec("SELECT 1") }

        DriverManager.getConnection(settings.jdbcUrl).use { connection ->
            val tables = connection.stringColumn(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
                    "AND name != 'flyway_schema_history'",
            )
            tables.toSet() shouldBe setOf("users", "households", "tasks", "shopping_items")
            connection.count("SELECT COUNT(*) FROM households") shouldBe 1
            connection.stringColumn("SELECT name FROM users ORDER BY name") shouldBe listOf("User 1", "User 2")
            connection.count(
                "SELECT COUNT(*) FROM users WHERE household_id = '00000000-0000-0000-0000-000000000001'",
            ) shouldBe 2
            connection.count("SELECT COUNT(*) FROM flyway_schema_history") shouldBe 2
            connection.stringColumn("SELECT name FROM pragma_table_info('tasks')") shouldContain "archived_at"
        }
    }

    private fun Connection.count(sql: String): Int = createStatement().use { statement ->
        statement.executeQuery(sql).use { result ->
            result.next()
            result.getInt(1)
        }
    }

    private fun Connection.stringColumn(sql: String): List<String> = createStatement().use { statement ->
        statement.executeQuery(sql).use { result ->
            buildList {
                while (result.next()) add(result.getString(1))
            }
        }
    }
}
