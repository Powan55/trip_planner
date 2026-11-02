// Used by the error screens (#946). A crash in the root layout takes the registrar down with
// it, and the registrar is the only other SKIP_WAITING sender, so a fixed worker would sit in
// waiting while Reload kept serving the same cached shell. Resolves true once a waiting worker
// was told to take over; the caller then reloads onto it.
export async function applyWaitingUpdate(timeoutMs = 3000): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const sw = navigator.serviceWorker;
    const reg = await sw.getRegistration();
    if (!reg) return false;
    // Offline, a worker that already installed can still take over; only the check needs a network.
    if (navigator.onLine) {
      // Capped: a slow sw.js fetch must not hold the error screen's button.
      await Promise.race([reg.update().catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))]);
    }
    const waiting = reg.waiting;
    if (!waiting) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      sw.addEventListener(
        'controllerchange',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    return true;
  } catch {
    return false;
  }
}
