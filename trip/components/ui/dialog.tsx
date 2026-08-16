'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { overlayMotion } from '@/lib/motion';

/**
 * D-292's no-exceptions clause, enforced instead of remembered (issue #24): a dialog is Tier 3
 * whatever route opened it, so it asks `lib/motion.ts` for permission rather than carrying
 * shadcn's default spring. `isMotionAllowed('entrance', OVERLAY_TIER)` is false, so what ships
 * is CALM — and if the tier table ever changes, this follows it without an edit here.
 *
 * CALM is not "nothing" (R8: every path forks to its END state, never to nothing). It is the
 * design system's dialog budget: ≤200 ms opacity + an 8 px rise in, ≤160 ms opacity out.
 * What Tier 3 revokes is the `zoom-in-95` scale — the spec's "no spring, no scale-from-0.9".
 *
 * The `slide-in-from-top-[48%]` pairing with `translate-y-[-50%]` is load-bearing and is NOT a
 * typo for a 2 px slide: tailwindcss-animate's `enter` keyframe REPLACES the element's own
 * transform, so the 48/50 pair is what keeps a centred dialog centred while it rises the last
 * 2% of its height into place. A plain `slide-in-from-bottom-2` here would drop the centring
 * for the length of the animation and the dialog would fly in from the corner.
 */
const DIALOG_ENTER_LOUD =
  'duration-200 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]';
const DIALOG_ENTER_CALM =
  'duration-200 data-[state=closed]:duration-150 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:rounded-lg',
        overlayMotion('entrance', DIALOG_ENTER_LOUD, DIALOG_ENTER_CALM),
        className
      )}
      {...props}
    >
      {children}
      {/* hit-area-only fix — inline-flex + min-h/w-[44px]
          grows the invisible CLICKABLE box only; the icon size and corner anchoring
          (right-4 top-4) are unchanged, so no visible pixels shift (proved by the
          open-palette visual baseline this change adds — visual.spec.ts). This is the
          shared Radix close reachable only via command-palette.tsx; the
          5 other dialogs (calendar editor, add-to-itinerary, expense log, place detail,
          time picker) render their own inline close buttons and are untouched. */}
      <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
