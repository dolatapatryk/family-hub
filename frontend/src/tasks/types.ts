import type { createTasksApi, UpdateTaskInput } from './api'

export type CreateTasksApi = ReturnType<typeof createTasksApi>
export type { UpdateTaskInput }
