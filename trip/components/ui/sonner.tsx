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
      // Lift toasts above the mobile bottom tab bar so a toast never covers it.
      // sonner 1.5.0 has no `mobileOffset` prop, and its own
      // `@media (max-width:600px)` styles HARD-SET the toaster's `bottom: 20px`, so this
      // `offset` prop only ever reaches the DESKTOP (>600px) layout. The mobile bottom edge
      // is therefore re-anchored by a scoped `!important` override in app/globals.css
      // (`[data-sonner-toaster][data-y-position='bottom']`) using the same calc. Keep this
      // prop for desktop; keep the calc in both places in sync.
      offset="calc(var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 8px)"
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
