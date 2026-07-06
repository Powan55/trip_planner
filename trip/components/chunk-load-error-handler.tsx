'use client'

// IMPORTANT: Do not remove this component.
// It handles a known Next.js dev server race condition where dynamic chunks
// imported by next/dynamic haven't been compiled yet and cause webpack to throw
// a ChunkLoadError

import { useEffect } from 'react'
import { chunkReloadGuard } from '@/core/storage/gateway'

export function ChunkLoadErrorHandler() {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      if (
        event.error?.name === 'ChunkLoadError' ||
        event.error?.message?.includes('Loading chunk')
      ) {
        event.preventDefault()
        // Recover a chunk-load race with a SINGLE reload per session. If a ChunkLoadError
        // still fires after we've already auto-reloaded once, the reload isn't fixing it — log and
        // STOP rather than looping. The one-shot flag lives in the typed gateway, session-
        // backed so it resets when the tab closes.
        if (chunkReloadGuard.hasReloaded()) {
          console.warn('[chunk-load] ChunkLoadError persisted after an auto-reload — not reloading again.')
          return
        }
        chunkReloadGuard.markReloaded()
        window.location.reload()
      }
    }
    window.addEventListener('error', handler)
    return () => window.removeEventListener('error', handler)
  }, [])

  return null
}
