import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      {action && <div className="page-head-action">{action}</div>}
    </header>
  )
}
