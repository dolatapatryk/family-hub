import { Link, NavLink, Route, Routes } from 'react-router-dom'

const pages = [
  { path: '/', label: 'Today', title: 'A little more together.', description: 'Your family’s day, in one place.', sections: ['Today’s tasks', 'Today’s calendar'] },
  { path: '/tasks', label: 'Tasks', title: 'Make room for what matters.', description: 'A shared place for the things that need doing.', sections: ['Family tasks'] },
  { path: '/shopping', label: 'Shop', title: 'The next grocery run, sorted.', description: 'One shopping list for the whole family.', sections: ['Shopping list'] },
  { path: '/calendar', label: 'Calendar', title: 'Know what’s coming up.', description: 'Your shared calendar, all in one view.', sections: ['Family calendar'] },
]

function Page({ page }: { page: (typeof pages)[number] }) {
  return (
    <>
      <p className="eyebrow">{page.label === 'Shop' ? 'Shopping' : page.label}</p>
      <h1>{page.title}</h1>
      <p className="intro">{page.description}</p>
      <div className="cards">
        {page.sections.map(section => (
          <section className="card" key={section}>
            <h2>{section}</h2>
            <p>This space is getting ready. Check back soon.</p>
            <span className="badge">Coming soon</span>
          </section>
        ))}
      </div>
    </>
  )
}

export function App() {
  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="header">
        <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">F</span>Family Hub</Link>
        <span className="header-note">Our everyday, together</span>
      </header>
      <nav className="navigation" aria-label="Main navigation">
        {pages.map(page => (
          <NavLink key={page.path} to={page.path} end={page.path === '/'}>{page.label}</NavLink>
        ))}
      </nav>
      <main id="main" tabIndex={-1}>
        <Routes>
          {pages.map(page => <Route key={page.path} path={page.path} element={<Page page={page} />} />)}
          <Route path="*" element={<><h1>Page not found</h1><Link to="/">Back to Today</Link></>} />
        </Routes>
      </main>
    </div>
  )
}

