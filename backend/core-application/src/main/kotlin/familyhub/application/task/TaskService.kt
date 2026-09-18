package familyhub.application.task

import familyhub.application.transaction.TransactionRunner
import familyhub.domain.task.InvalidTask
import familyhub.domain.task.Task
import familyhub.domain.task.TaskFilter
import familyhub.domain.task.TaskId
import familyhub.domain.task.TaskRepository
import familyhub.domain.user.User
import familyhub.domain.user.UserId
import familyhub.domain.user.UserRepository
import java.time.Clock
import java.time.Clock.systemUTC
import java.time.Instant.now

class TaskService(
    private val tasks: TaskRepository,
    private val users: UserRepository,
    private val transactions: TransactionRunner,
    private val clock: Clock = systemUTC(),
) {

    fun list(filter: TaskFilter): List<Task> = tasks.list(filter)

    fun get(user: User, id: TaskId): Task = tasks.get(id, user.householdId)

    fun create(user: User, command: CreateTask): Task {
        val task = Task.create(
            title = command.title,
            householdId = user.householdId,
            dueDate = command.dueDate,
            createdBy = user.id,
            now = now(clock),
        )
        return tasks.save(task)
    }

    fun update(user: User, id: TaskId, command: UpdateTask): Task = transactions.execute {
        val task = get(user, id)
        val updated = task.update(
            title = command.title ?: task.title,
            dueDate = command.dueDate.orElse(task.dueDate),
        )
        tasks.save(updated)
    }

    fun assignTo(user: User, id: TaskId, assigneeId: UserId): Task = transactions.execute {
        val task = get(user, id)
        val assignee = users.find(assigneeId) ?: throw InvalidTask("Assignee does not exist")
        if (assignee.householdId != task.householdId) {
            throw InvalidTask("Assignee must belong to the task's household")
        }
        tasks.save(task.assignTo(assignee.id))
    }

    fun unassign(user: User, id: TaskId): Task = transactions.execute {
        val task = get(user, id)
        tasks.save(task.unassign())
    }

    fun complete(user: User, id: TaskId): Task = transactions.execute {
        val task = get(user, id)
        tasks.save(task.complete())
    }

    fun reopen(user: User, id: TaskId): Task = transactions.execute {
        val task = get(user, id)
        tasks.save(task.reopen())
    }

    fun archive(user: User, id: TaskId): Task = transactions.execute {
        val task = get(user, id)
        tasks.save(task.archive(now(clock)))
    }
}
