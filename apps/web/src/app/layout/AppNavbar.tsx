import ThemeToggle from './ThemeToggle'

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.335-1.756-1.335-1.756-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

interface AppNavbarProps {
  pageTitle: string
}

export default function AppNavbar({ pageTitle }: AppNavbarProps) {
  return (
    <header data-region="navbar" className="la-pluma-navbar">
      <div className="la-pluma-navbar-inner" data-region="page-header">
        <h1 data-region="page-title" className="la-pluma-navbar-title">{pageTitle}</h1>
        <div className="la-pluma-navbar-actions">
          <ThemeToggle />
          <a
            href="https://github.com/dongwlin/La-pluma-next"
            target="_blank"
            rel="noopener noreferrer"
            className="la-pluma-github-link"
            aria-label="打开 GitHub 仓库"
          >
            <GitHubMark />
          </a>
        </div>
      </div>
    </header>
  )
}
