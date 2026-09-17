package familyhub

import familyhub.support.setupTestApp
import io.kotest.assertions.ktor.client.shouldHaveStatus
import io.kotest.matchers.shouldBe
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.nio.file.Path
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class ApplicationSpec {
    @TempDir
    lateinit var directory: Path

    @Test
    fun `health is available without user identification`() = testApplication {
        setupTestApp(directory)

        val response = client.get("/health")

        response shouldHaveStatus HttpStatusCode.OK
        response.contentType()?.withoutParameters() shouldBe ContentType.Application.Json
        response.bodyAsText() shouldBe "{\"status\":\"ok\"}"
    }
}
