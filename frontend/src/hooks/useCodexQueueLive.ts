import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '../types/ci'
import type { CodexQueueSnapshot } from '../types/codexQueue'
import { getApiBase } from '../lib/apiBase'

const SSE_URL = `${getApiBase()}/ci/codex/events`

export function useCodexQueueLive(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<CodexQueueSnapshot | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [problem, setProblem] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const connect = useCallback(() => {
    if (esRef.current) return

    setStatus('connecting')
    const es = new EventSource(SSE_URL)
    esRef.current = es

    const handleSnapshot = (event: MessageEvent<string>) => {
      setSnapshot(JSON.parse(event.data) as CodexQueueSnapshot)
      setProblem(null)
      setStatus('connected')
      retryRef.current = 0
    }

    es.addEventListener('init', handleSnapshot)
    es.addEventListener('update', handleSnapshot)
    es.addEventListener('problem', (event) => {
      setProblem(JSON.parse((event as MessageEvent<string>).data) as string)
    })

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')

      const delay = Math.min(1000 * 2 ** retryRef.current, 30000)
      retryRef.current += 1
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

  return { snapshot, status, problem }
}
