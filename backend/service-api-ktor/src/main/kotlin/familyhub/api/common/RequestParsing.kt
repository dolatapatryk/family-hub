package familyhub.api.common

import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.util.UUID

fun parseUuid(value: String, field: String): UUID {
    return try {
        UUID.fromString(value)
    } catch (_: IllegalArgumentException) {
        throw BadRequestException("$field must be a UUID")
    }
}

fun parseDate(value: String, field: String): LocalDate = try {
    LocalDate.parse(value)
} catch (_: DateTimeParseException) {
    throw BadRequestException("$field must be an ISO date (YYYY-MM-DD)")
}

fun parseBoolean(value: String, field: String): Boolean =
    value.toBooleanStrictOrNull() ?: throw BadRequestException("$field must be true or false")
