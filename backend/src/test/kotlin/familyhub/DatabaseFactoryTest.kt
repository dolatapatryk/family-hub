package familyhub

import familyhub.infrastructure.persistence.DatabaseFactory
import familyhub.infrastructure.persistence.DatabaseSettings
import org.jetbrains.exposed.sql.transactions.transaction
import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DatabaseFactoryTest {

    @Test
    fun `initial migrations create schema and seed the family`() {
        val databaseDirectory = Files.createTempDirectory("family-hub-database-test")
        val settings = DatabaseSettings(databaseDirectory.resolve("family.db").toString())

        try {
            val database = DatabaseFactory(settings).initialize()
            transaction(database) {
                exec("SELECT 1")
            }

            DriverManager.getConnection(settings.jdbcUrl).use { connection ->
                assertEquals(
                    setOf("users", "households", "tasks", "shopping_items"),
                    connection.createStatement().use { statement ->
                        statement.executeQuery(
                            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
                                "AND name != 'flyway_schema_history'",
                        ).use { resultSet ->
                            buildSet {
                                while (resultSet.next()) add(resultSet.getString("name"))
                            }
                        }
                    },
                )

                assertEquals(
                    1,
                    connection.createStatement().use { statement ->
                        statement.executeQuery("SELECT COUNT(*) FROM households").use { resultSet ->
                            resultSet.next()
                            resultSet.getInt(1)
                        }
                    },
                )
                assertEquals(
                    listOf("User 1", "User 2"),
                    connection.createStatement().use { statement ->
                        statement.executeQuery("SELECT name FROM users ORDER BY name").use { resultSet ->
                            buildList {
                                while (resultSet.next()) add(resultSet.getString("name"))
                            }
                        }
                    },
                )
                assertEquals(
                    2,
                    connection.createStatement().use { statement ->
                        statement.executeQuery(
                            "SELECT COUNT(*) FROM users WHERE household_id = '00000000-0000-0000-0000-000000000001'",
                        ).use { resultSet ->
                            resultSet.next()
                            resultSet.getInt(1)
                        }
                    },
                )
                assertTrue(
                    connection.createStatement().use { statement ->
                        statement.executeQuery("SELECT COUNT(*) FROM flyway_schema_history").use { resultSet ->
                            resultSet.next()
                            resultSet.getInt(1) == 2
                        }
                    },
                )
            }
        } finally {
            databaseDirectory.toFile().deleteRecursively()
        }
    }
}
