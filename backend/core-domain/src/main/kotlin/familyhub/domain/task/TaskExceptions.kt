package familyhub.domain.task

class InvalidTask(message: String) : RuntimeException(message)
class TaskNotFound : RuntimeException("Task not found")
class TaskArchived : RuntimeException("Archived tasks cannot be changed")
