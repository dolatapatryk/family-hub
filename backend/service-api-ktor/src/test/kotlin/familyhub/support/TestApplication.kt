package familyhub.support

import familyhub.api.task.TaskResponse
import familyhub.domain.household.HouseholdId
import familyhub.domain.household.HouseholdId.Companion.randomHouseholdId
import familyhub.domain.user.User
import familyhub.domain.user.UserId
import familyhub.domain.user.UserId.Companion.randomUserId
import familyhub.infrastructure.persistence.DatabaseFactory
import familyhub.infrastructure.persistence.DatabaseSettings
import familyhub.infrastructure.persistence.ExposedUserRepository
import familyhub.module
import io.kotest.assertions.ktor.client.shouldHaveStatus
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType.Application.Json
import io.ktor.http.HttpStatusCode
import io.ktor.http.HttpStatusCode.Companion.OK
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.testing.ApplicationTestBuilder
import java.nio.file.Path
import java.sql.DriverManager
import java.util.UUID

object TestUsers {
    val author = UserId(UUID.fromString("00000000-0000-0000-0000-000000000101"))
    val partner = UserId(UUID.fromString("00000000-0000-0000-0000-000000000102"))
}

fun ApplicationTestBuilder.setupTestApp(directory: Path) {
    application { module(DatabaseSettings(directory.resolve("family.db").toString())) }
}

fun ApplicationTestBuilder.userClient(userId: UserId = TestUsers.author): HttpClient = createClient {
    install(ContentNegotiation) { json() }
    defaultRequest {
        header("X-User-Id", userId.toString())
        contentType(Json)
    }
}

fun seedOtherHousehold(directory: Path): User {
    val settings = DatabaseSettings(directory.resolve("family.db").toString())
    val database = DatabaseFactory(settings).initialize()
    val user = User(randomUserId(), randomHouseholdId(), "Other household user")
    DriverManager.getConnection(settings.jdbcUrl).use { connection ->
        connection.prepareStatement("INSERT INTO households (id, name) VALUES (?, ?)").use { statement ->
            statement.setString(1, user.householdId.toString())
            statement.setString(2, "Other household")
            statement.executeUpdate()
        }
    }
    ExposedUserRepository(database).save(user)
    return user
}

suspend fun HttpResponse.task(expectedStatus: HttpStatusCode = OK): TaskResponse {
    this shouldHaveStatus expectedStatus
    return body()
}
