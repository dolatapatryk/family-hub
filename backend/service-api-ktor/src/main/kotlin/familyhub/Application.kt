package familyhub

import familyhub.api.common.configureExceptionHandling
import familyhub.api.task.taskRoutes
import familyhub.application.task.TaskService
import familyhub.application.user.UserService
import familyhub.infrastructure.persistence.DatabaseFactory
import familyhub.infrastructure.persistence.DatabaseSettings
import familyhub.infrastructure.persistence.ExposedTaskRepository
import familyhub.infrastructure.persistence.ExposedTransactionRunner
import familyhub.infrastructure.persistence.ExposedUserRepository
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationEnvironment
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

fun main() {
    embeddedServer(Netty, host = "0.0.0.0", port = 8080, module = { module() }).start(wait = true)
}

fun Application.module(databaseSettings: DatabaseSettings? = null) {
    install(ContentNegotiation) { json() }
    configureExceptionHandling()

    val database = DatabaseFactory(databaseSettings ?: environment.databaseSettings()).initialize()
    val users = ExposedUserRepository(database)
    val taskService = TaskService(
        tasks = ExposedTaskRepository(database),
        users = users,
        transactions = ExposedTransactionRunner(database),
    )

    routing {
        taskRoutes(taskService, UserService(users))
        get("/health") { call.respond(HealthResponse("ok")) }
    }
}

private fun ApplicationEnvironment.databaseSettings(): DatabaseSettings {
    val configuredPath = config.propertyOrNull("family.database.path")?.getString()
        ?.trim()?.takeIf(String::isNotEmpty)
    val environmentPath = System.getenv("DATABASE_PATH")?.trim()?.takeIf(String::isNotEmpty)
    return DatabaseSettings(configuredPath ?: environmentPath ?: DatabaseSettings.DEFAULT_PATH)
}

@Serializable
data class HealthResponse(val status: String)
