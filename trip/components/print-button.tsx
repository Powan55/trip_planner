'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * PrintButton — the one entry point to the paper fallback (issue #223).
 *
 * WHY A BUTTON AT ALL, when Ctrl/Cmd+P already exists: this app is used one-handed on a
 * phone, and a phone has no print shortcut — printing there is buried three taps deep in
 * a share sheet most people never open for that. A print stylesheet nobody can find is a
 * feature that only works for whoever wrote it.
 *
 * It carries `print:hidden` itself rather than relying on a wrapper, so it can never
 * print its own control onto the sheet no matter where a caller mounts it. Sizing comes
 * from the shared Button (`size="sm"` sits on `--tap`, the 44px floor), so the outdoor /
 * cold-weather tap target is inherited rather than re-derived.
 */
export default function PrintButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      data-testid="print-button"
      className="print:hidden"
    >
      <Printer aria-hidden="true" />
      {label}
    </Button>
  );
}
