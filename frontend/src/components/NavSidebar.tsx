import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const NAV_SECTIONS = [
  {
    label: 'Infrastructure',
    routes: [
      { path: '/', label: 'Overview' },
      { path: '/pipelines', label: 'Pipelines' },
    ],
  },
  {
    label: 'CI',
    routes: [
      { path: '/ci', label: 'Dashboard' },
      { path: '/ci/fzt', label: 'fzt' },
      { path: '/ci/api', label: 'api' },
      { path: '/ci/tofu', label: 'tofu' },
    ],
  },
  {
    label: 'fzt',
    routes: [
      { path: '/fzt', label: 'Architecture' },
      { path: '/fzt/final', label: 'Final' },
      { path: '/fzt/repos', label: 'Repos' },
      { path: '/fzt/shared', label: 'Shared' },
      { path: '/fzt/proposed', label: 'Proposed' },
      { path: '/fzt/matrix', label: 'Matrix' },
    ],
  },
  {
    label: 'Other',
    routes: [
      { path: '/certs', label: 'Cert Concepts' },
      { path: '/emotions', label: 'Emotions' },
    ],
  },
]

export default function NavSidebar() {
  const [collapsed, setCollapsed] = useState(true)
  const location = useLocation()

  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-50 flex transition-transform duration-200"
      style={{ transform: collapsed ? 'translateX(100%)' : 'translateX(0)' }}
    >
      {/* Toggle tab */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute right-full top-3 w-8 h-10 flex items-center justify-center rounded-l-md border border-r-0 border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer text-lg"
        style={{ transform: collapsed ? 'scaleX(1)' : 'scaleX(-1)' }}
      >
        &#8249;
      </button>

      {/* Panel */}
      <div className="w-48 bg-slate-900 border-l border-slate-700 overflow-y-auto py-4 px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 px-2">
              {section.label}
            </div>
            {section.routes.map((route) => {
              const active = location.pathname === route.path
              return (
                <Link
                  key={route.path}
                  to={route.path}
                  className={`block px-2 py-1 rounded text-xs transition-colors ${
                    active
                      ? 'bg-slate-800 text-slate-200'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  {route.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
