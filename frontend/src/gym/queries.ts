export const gymKeys = {
  root: (userId: string) => ['gym', userId] as const,
  templates: (userId: string, includeArchived = false) => ['gym', userId, 'templates', { includeArchived }] as const,
  template: (userId: string, templateId: string) => ['gym', userId, 'template', templateId] as const,
  plans: (userId: string) => ['gym', userId, 'plans'] as const,
  activePlan: (userId: string) => ['gym', userId, 'activePlan'] as const,
  plan: (userId: string, planId: string) => ['gym', userId, 'plan', planId] as const,
  workouts: (userId: string, planId: string) => ['gym', userId, 'plan', planId, 'workouts'] as const,
}
