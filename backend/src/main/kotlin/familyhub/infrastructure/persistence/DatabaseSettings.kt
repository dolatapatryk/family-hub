package familyhub.infrastructure.persistence

import io.ktor.server.application.ApplicationEnvironment
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

data class DatabaseSettings(val path: String) {
    init {
        require(path.isNotBlank()) { "Database path must not be blank" }
    }

    val jdbcUrl: String
        get() = if (path.startsWith("jdbc:")) path else "jdbc:sqlite:$path"

    fun ensureParentDirectory() {
        if (path.startsWith("jdbc:") || path.startsWith("file:") || path == ":memory:") return

        val databaseFile: Path = Paths.get(path).toAbsolutePath()
        databaseFile.parent?.let(Files::createDirectories)
    }

    companion object {
        const val DEFAULT_PATH = "data/family.db"

        fun from(environment: ApplicationEnvironment): DatabaseSettings {
            val configuredPath = environment.config
                .propertyOrNull("family.database.path")
                ?.getString()
                ?.trim()
                ?.takeIf(String::isNotEmpty)

            return DatabaseSettings(
                configuredPath ?: System.getenv("DATABASE_PATH")?.trim()?.takeIf(String::isNotEmpty)
                ?: DEFAULT_PATH,
            )
        }
    }
}
