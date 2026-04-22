import { useState, useEffect, useRef, useCallback } from 'react'
import type { CIRun, PublishedVersion, DeployedVersion, VersionErrors, ConnectionStatus } from '../types/ci'
import { getApiBase } from '../lib/apiBase'

// Same-origin in production. For local preview or dev, the backend stays on
// :3000 while the frontend can be served from :5505.
const API_BASE = getApiBase()

const SSE_URL = `${API_BASE}/ci/events`

export function useSSE(enabled: boolean) {
  const [runs, setRuns] = useState<Map<string, CIRun>>(new Map())
  const [versions, setVersions] = useState<Map<string, PublishedVersion>>(new Map())
  const [deployed, setDeployed] = useState<Map<string, DeployedVersion>>(new Map())
  const [versionErrors, setVersionErrors] = useState<VersionErrors>({})
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const connect = useCallback(() => {
    if (esRef.current) return

    setStatus('connecting')
    const es = new EventSource(SSE_URL)
    esRef.current = es

    es.addEventListener('init', (e) => {
      const snapshot = JSON.parse(e.data)

      const runMap = new Map<string, CIRun>()
      for (const run of snapshot.runs || []) {
        runMap.set(`${run.repo}/${run.runId}`, run)
      }
      setRuns(runMap)

      const verMap = new Map<string, PublishedVersion>()
      for (const v of snapshot.versions || []) {
        verMap.set(v.repoName, v)
      }
      setVersions(verMap)

      const depMap = new Map<string, DeployedVersion>()
      for (const d of snapshot.deployed || []) {
        depMap.set(d.repo, d)
      }
      setDeployed(depMap)

      setVersionErrors(snapshot.versionErrors || {})

      setStatus('connected')
      retryRef.current = 0
    })

    es.addEventListener('update', (e) => {
      const run: CIRun = JSON.parse(e.data)
      setRuns((prev) => {
        const next = new Map(prev)
        next.set(`${run.repo}/${run.runId}`, run)
        return next
      })
    })

    es.addEventListener('version', (e) => {
      const ver: PublishedVersion = JSON.parse(e.data)
      setVersions((prev) => {
        const next = new Map(prev)
        next.set(ver.repoName, ver)
        return next
      })
    })

    es.addEventListener('deployed', (e) => {
      const dep: DeployedVersion = JSON.parse(e.data)
      setDeployed((prev) => {
        const next = new Map(prev)
        next.set(dep.repo, dep)
        return next
      })
    })

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')

      const delay = Math.min(1000 * 2 ** retryRef.current, 30000)
      retryRef.current++
      timerRef.current = window.setTimeout(connect, delay)
    }
  }, [])

  const disconnect = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setStatus('disconnected')
    retryRef.current = 0
  }, [])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }
    return disconnect
  }, [enabled, connect, disconnect])

  return { runs, versions, deployed, versionErrors, status, disconnect }
}
