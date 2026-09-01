'use client';

import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { overlayMotion } from '@/lib/motion';

/**
 * The same D-292 pin as `components/ui/dialog.tsx`: a sheet is Tier 3 whatever route opened it,
 * so the timing comes from `lib/motion.ts`'s gate and not from shadcn's default. What Tier 3
 * revokes here is the DURATION — 500 ms in / 300 ms out is over the design system's overlay
 * budget of ≤200 ms in, ≤160 ms out, and R3's 900 ms ceiling is not the binding limit
 * for something that opens over what you were reading. The side slide itself is kept: it is an
 * opacity + translate, not a spring, and it is how a sheet says which edge it came from.
 */
const SHEET_TIMING_LOUD = 'data-[state=closed]:duration-300 data-[state=open]:duration-500';
const SHEET_TIMING_CALM = 'data-[state=closed]:duration-150 data-[state=open]:duration-200';

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

/**
 * TWO edges, not four. `right` is the drawer every non-Travel-Mode mount uses and was also the
 * cva `defaultVariants`; `bottom` exists for the Travel Mode concierge, which rises from the
 * thumb zone that triggers it instead of sliding in from an edge no thumb is near. The other two
 * cva branches stay deleted — they were unreachable configuration. Each string below is what cva
 * concatenated (base, then side) already resolved to.
 */
const SHEET_CONTENT_BASE = `fixed z-50 gap-4 bg-background p-gut py-5 transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out ${overlayMotion(
  'entrance',
  SHEET_TIMING_LOUD,
  SHEET_TIMING_CALM,
)}`;

const SHEET_CONTENT_SIDE = {
  right:
    'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
  // `mx-auto` is inert at full width and only bites once a caller caps it (the concierge's
  // `sm:max-w-lg`), which centres the sheet on a desktop viewport instead of pinning it left.
  bottom:
    'inset-x-0 bottom-0 mx-auto w-full border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
} as const;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
    side?: keyof typeof SHEET_CONTENT_SIDE;
  }
>(({ className, children, side = 'right', ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(SHEET_CONTENT_BASE, SHEET_CONTENT_SIDE[side], className)}
      {...props}
    >
      {children}
      {/* hit-area-only, copied from `ui/dialog.tsx`: `inline-flex` + the --tap floor grow the
          invisible clickable box; the icon size and corner anchoring are unchanged, so no
          visible pixels move. This close was 17x17 — the concierge sheet's ONLY close control. */}
      <SheetPrimitive.Close className="absolute right-4 top-4 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-2 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
SheetHeader.displayName = 'SheetHeader';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('font-sans text-t-lead font-semibold leading-tight text-[color:var(--text-hi)]', className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-t-body text-[color:var(--text-mid)]', className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

// `SheetPortal` and `SheetOverlay` stay unexported: `SheetContent` is their only caller.
export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription };
