package familyhub.infrastructure.persistence

import familyhub.domain.household.HouseholdId
import familyhub.domain.user.User
import familyhub.domain.user.UserId
import familyhub.domain.user.UserRepository
import java.util.UUID
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update

internal object Users : Table("users") {
    val id = text("id")
    val householdId = text("household_id")
    val name = text("name")
    override val primaryKey = PrimaryKey(id)
}

class ExposedUserRepository(private val database: Database) : UserRepository {
    override fun find(id: UserId): User? = transaction(database) {
        Users.selectAll().where { Users.id eq id.toString() }.singleOrNull()?.let { row ->
            User(
                id = UserId(UUID.fromString(row[Users.id])),
                householdId = HouseholdId(UUID.fromString(row[Users.householdId])),
                name = row[Users.name],
            )
        }
    }

    override fun save(user: User): User = transaction(database) {
        val updatedRows = Users.update({ Users.id eq user.id.toString() }) {
            it[householdId] = user.householdId.toString()
            it[name] = user.name
        }
        if (updatedRows == 0) {
            Users.insert {
                it[id] = user.id.toString()
                it[householdId] = user.householdId.toString()
                it[name] = user.name
            }
        }
        user
    }
}
