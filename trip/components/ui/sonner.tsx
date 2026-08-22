'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      ///DEF-1: lift toasts above the mobile bottom tab bar so a toast never covers it.
      // This `offset` prop only reaches the DESKTOP (>600px) layout. Under 600px sonner sets
      // its own `bottom: var(--mobile-offset-bottom)`, which defaults to 16px — i.e. on top of
      // the tab bar. The mobile bottom edge is re-anchored by a scoped `!important` override in
      // app/globals.css (`[data-sonner-toaster][data-y-position='bottom']`) using the same calc.
      // Keep this prop for desktop; keep the calc in both places in sync.
      // Since 2.x there is also a `mobileOffset` prop; switching to it would retire the CSS
      // override, but it needs the OBJECT form ({bottom, left, right, top}) — a bare string sets
      // the horizontal insets too and would squash the toast to 72px side margins.
      offset="calc(var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 8px)"
      // WCAG 2.1.1: sonner's only built-in dismissal is a pointer swipe, and Escape
      // collapses the stack rather than closing anything. A `duration: Infinity` toast
      // (the service-worker update prompt) was therefore keyboard-undismissable — its one
      // action reloads the app. Set on the Toaster, not per toast, so the next permanent
      // toast inherits the way out.
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
