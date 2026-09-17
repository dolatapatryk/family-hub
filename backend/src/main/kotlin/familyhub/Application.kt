package familyhub

import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import familyhub.infrastructure.persistence.DatabaseFactory
import familyhub.infrastructure.persistence.DatabaseSettings
import kotlinx.serialization.Serializable

fun main() {
    embeddedServer(Netty, host = "0.0.0.0", port = 8080, module = { module() }).start(wait = true)
}

fun Application.module(databaseSettings: DatabaseSettings? = null) {
    install(ContentNegotiation) { json() }
    DatabaseFactory(databaseSettings ?: DatabaseSettings.from(environment)).initialize()

    routing {
        get("/health") { call.respond(HealthResponse("ok")) }
    }
}

@Serializable
data class HealthResponse(val status: String)
