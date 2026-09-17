package familyhub.infrastructure.persistence

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
    }
}
