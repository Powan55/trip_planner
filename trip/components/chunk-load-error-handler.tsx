'use client'

// IMPORTANT: Do not remove this component.
// It handles a known Next.js dev server race condition where dynamic chunks
// imported by next/dynamic haven't been compiled yet and cause webpack to throw
// a ChunkLoadError

import { useEffect } from 'react'
import { chunkReloadGuard } from '@/core/storage/gateway'

function isChunkLoadError(error: unknown): boolean {
  const err = error as { name?: string; message?: string } | undefined
  return err?.name === 'ChunkLoadError' || !!err?.message?.includes('Loading chunk')
}

export function ChunkLoadErrorHandler() {
  useEffect(() => {
    // recover a chunk-load race with a SINGLE reload per session. If a ChunkLoadError
    // still fires after we've already auto-reloaded once, the reload isn't fixing it — log and
    // STOP rather than looping. The one-shot flag lives in the typed gateway, session-
    // backed so it resets when the tab closes.
    const reload = () => {
      if (chunkReloadGuard.hasReloaded()) {
        console.warn('[chunk-load] ChunkLoadError persisted after an auto-reload — not reloading again.')
        return
      }
      chunkReloadGuard.markReloaded()
      window.location.reload()
    }
    const handler = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error)) {
        event.preventDefault()
        reload()
      }
    }
    // A lazy `import()` (next/dynamic) that fails to fetch a chunk rejects its
    // promise rather than throwing synchronously — that surfaces here, not via
    // `error`. Same stale-precache trigger as #531 (a passive tab that never
    // reloaded after an update, hitting a chunk the old shell doesn't have).
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        event.preventDefault()
        reload()
      }
    }
    window.addEventListener('error', handler)
    window.addEventListener('unhandledrejection', rejectionHandler)
    return () => {
      window.removeEventListener('error', handler)
      window.removeEventListener('unhandledrejection', rejectionHandler)
    }
  }, [])

  return null
}
