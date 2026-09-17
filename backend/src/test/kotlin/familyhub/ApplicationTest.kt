package familyhub

import familyhub.infrastructure.persistence.DatabaseSettings
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

class ApplicationTest {
    @Test
    fun `health is available without user identification`() {
        val databaseDirectory = Files.createTempDirectory("family-hub-health-test")
        try {
            testApplication {
                application { module(DatabaseSettings(databaseDirectory.resolve("family.db").toString())) }
                val response = client.get("/health")
                assertEquals(HttpStatusCode.OK, response.status)
                assertEquals(ContentType.Application.Json, response.contentType()?.withoutParameters())
                assertEquals("{\"status\":\"ok\"}", response.bodyAsText())
            }
        } finally {
            databaseDirectory.toFile().deleteRecursively()
        }
    }
}
