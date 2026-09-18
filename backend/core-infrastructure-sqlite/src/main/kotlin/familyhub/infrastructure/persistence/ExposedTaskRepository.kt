package familyhub.infrastructure.persistence

import familyhub.domain.household.HouseholdId
import familyhub.domain.task.Task
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId
import familyhub.domain.task.TaskRepository
import familyhub.domain.user.UserId
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder.ASC
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.andWhere
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.upsert
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

internal object Tasks : Table("tasks") {
    val id = text("id")
    val householdId = text("household_id")
    val title = text("title")
    val dueDate = text("due_date").nullable()
    val completed = bool("completed")
    val assignedTo = text("assigned_to").nullable()
    val createdBy = text("created_by")
    val createdAt = text("created_at")
    val archivedAt = text("archived_at").nullable()
    override val primaryKey = PrimaryKey(id)
}

class ExposedTaskRepository(private val database: Database) : TaskRepository {

    override fun find(id: TaskId, householdId: HouseholdId): Task? = transaction(database) {
        Tasks.selectAll()
            .where { (Tasks.householdId eq householdId.toString()) and (Tasks.id eq id.toString()) }
            .singleOrNull()
            ?.toTask()
    }

    override fun list(filter: TaskFilter): List<Task> = transaction(database) {
        Tasks.selectAll()
            .where { Tasks.householdId eq filter.householdId.toString() }
            .apply {
                andWhere { if (filter.archived) Tasks.archivedAt.isNotNull() else Tasks.archivedAt.isNull() }
                filter.completed?.let { value -> andWhere { Tasks.completed eq value } }
                filter.from?.let { value -> andWhere { Tasks.dueDate greaterEq value.toString() } }
                filter.to?.let { value -> andWhere { Tasks.dueDate lessEq value.toString() } }
                filter.assignedTo?.let { value -> andWhere { Tasks.assignedTo eq value.toString() } }
            }
            .orderBy(Tasks.createdAt to ASC, Tasks.id to ASC)
            .map { it.toTask() }
    }

    override fun save(task: Task): Task = transaction(database) {
        Tasks.upsert {
            it[id] = task.id.toString()
            it[householdId] = task.householdId.toString()
            it[title] = task.title
            it[dueDate] = task.dueDate?.toString()
            it[completed] = task.completed
            it[assignedTo] = task.assignedTo?.toString()
            it[createdBy] = task.createdBy.toString()
            it[createdAt] = task.createdAt.toString()
            it[archivedAt] = task.archivedAt?.toString()
        }
        task
    }

    private fun ResultRow.toTask(): Task = Task(
        id = TaskId(UUID.fromString(this[Tasks.id])),
        householdId = HouseholdId(UUID.fromString(this[Tasks.householdId])),
        title = this[Tasks.title],
        dueDate = this[Tasks.dueDate]?.let(LocalDate::parse),
        completed = this[Tasks.completed],
        assignedTo = this[Tasks.assignedTo]?.let { UserId(UUID.fromString(it)) },
        createdBy = UserId(UUID.fromString(this[Tasks.createdBy])),
        createdAt = Instant.parse(this[Tasks.createdAt]),
        archivedAt = this[Tasks.archivedAt]?.let(Instant::parse),
    )
}
