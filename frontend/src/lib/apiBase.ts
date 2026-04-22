export function getApiBase() {
  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }

  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '3000') {
    return 'http://localhost:3000'
  }

  return ''
}
