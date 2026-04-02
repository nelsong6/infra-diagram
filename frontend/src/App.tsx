import { useState } from 'react'
import { BrowserRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom'
import DiagramView from './components/DiagramView'
import type { AppName } from './types'
import { APP_NAMES } from './types'

function DiagramPage() {
  const { app } = useParams<{ app: string }>()
  const navigate = useNavigate()

  const selectedApp = app && APP_NAMES.includes(app as AppName) ? (app as AppName) : null

  const [localSelected, setLocalSelected] = useState<AppName | null>(selectedApp)

  const handleSelect = (newApp: AppName | null) => {
    setLocalSelected(newApp)
    navigate(newApp ? `/${newApp}` : '/', { replace: true })
  }

  return <DiagramView selectedApp={localSelected} onSelectApp={handleSelect} />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DiagramPage />} />
        <Route path="/:app" element={<DiagramPage />} />
      </Routes>
    </BrowserRouter>
  )
}
