export const gymKeys = {
  root: (userId: string) => ['gym', userId] as const,
  templates: (userId: string, includeArchived = false) => ['gym', userId, 'templates', { includeArchived }] as const,
  template: (userId: string, templateId: string) => ['gym', userId, 'template', templateId] as const,
}
