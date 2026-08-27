import * as React from "react"
import { Slot, Slottable } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

// THE CONTROL, as the instrument draws it (SPEC 9.7 `.btn`).
//
// Four things moved and each is a rule, not a taste:
//   · NO `scale()`, anywhere. A press collapses the 3px lip and translates down by the
//     same 3px, so the control MOVES rather than swelling. `active:scale-[0.98]` grew the
//     button's optical weight on the one frame the user is looking at it.
//   · NO shadows and no glass. Hairlines are the layout here; a shadow is a second,
//     softer statement of an edge that is already drawn.
//   · DISABLED DOES NOT DIM. `opacity-50` multiplies every descendant's alpha and drops a
//     label straight through the AA floor — the same wrapper-opacity defect class
//     `lib/motion.ts` documents at FADE_FLOOR. A disabled control recedes by TIER
//     (`--surface-3` fill, `--text-lo` ink, lip removed) and keeps opacity 1.
//   · THE FOCUS RING GOES OUTWARD ON A SATURATED FILL. Measured: an accent ring drawn
//     INSIDE an accent fill is 1.00:1 and a white one 1.68:1 — i.e. no ring at all.
//     Offset outward it lands on the field at 19.80:1. `ring-offset` is load-bearing.
//
// `uppercase` is CSS only: it never touches the DOM text, so every accessible name and
// every `getByRole(name:)` assertion reads exactly what it read before.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-r1 font-machine text-t-label font-semibold uppercase tracking-[0.14em] transition-all [transition-duration:var(--duration-press)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:w-4 [&_svg]:h-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-[color:var(--cta-a)] to-[color:var(--cta-b)] text-[color:var(--on-accent)] border-b-[3px] border-b-[color:var(--lip-volt)] hover:brightness-110 active:translate-y-[3px] active:border-b-0 active:mb-[3px] focus-visible:ring-[color:var(--text-hi)] disabled:bg-none disabled:bg-[rgb(var(--surface-overlay))] disabled:text-[color:var(--text-lo)] disabled:border-b-0 disabled:cursor-not-allowed",
        destructive:
          "bg-destructive text-destructive-foreground border-b-[3px] border-b-[hsl(var(--destructive)/0.55)] hover:brightness-110 active:translate-y-[3px] active:border-b-0 active:mb-[3px] focus-visible:ring-[color:var(--text-hi)] disabled:bg-[rgb(var(--surface-overlay))] disabled:text-[color:var(--text-lo)] disabled:border-b-0 disabled:cursor-not-allowed",
        outline:
          "border border-[color:var(--border-ui)] border-b-[3px] border-b-[color:var(--border-ui)] bg-transparent text-[color:var(--text-hi)] hover:bg-white/5 active:translate-y-[3px] active:border-b active:mb-[2px] disabled:text-[color:var(--text-lo)] disabled:border-[hsl(var(--border))] disabled:cursor-not-allowed",
        secondary:
          "bg-[rgb(var(--surface-raised))] text-[color:var(--text-hi)] border-b-[3px] border-b-[hsl(var(--border))] hover:bg-white/5 active:translate-y-[3px] active:border-b-0 active:mb-[3px] disabled:text-[color:var(--text-lo)] disabled:cursor-not-allowed",
        ghost:
          "text-[color:var(--text-mid)] hover:bg-white/5 hover:text-[color:var(--text-hi)] disabled:text-[color:var(--text-lo)] disabled:cursor-not-allowed",
        link:
          "text-[color:hsl(var(--accent))] normal-case tracking-normal font-sans text-t-body underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-0 focus-visible:ring-offset-0 disabled:text-[color:var(--text-lo)]",
      },
      // Every size now sits on `--tap` (44px) rather than a fixed sub-floor height.
      // Measured at this app's 17px root, the old scale was default 42.5 · xs 29.75 ·
      // sm 38.25 · icon 42.5 · icon-sm 34 — five of six under the floor the token
      // declares. `lg` (h-11 = 46.75) already cleared it and is left alone. The size
      // names still differ in padding, radius and text step; they no longer differ in
      // how easy the control is to hit.
      size: {
        default: "min-h-tap px-4 py-2",
        xs: "min-h-tap px-2 text-t-micro tracking-[0.12em]",
        sm: "min-h-tap px-3",
        lg: "min-h-tap py-3 px-6 text-t-body tracking-[0.1em]",
        icon: "h-tap w-tap",
        "icon-sm": "min-h-tap min-w-tap",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* `motion-safe:` — a 1s infinite spin is under D-293 rule 2's floor, so it carries
            its own reduced-motion fork rather than leaning on the globals.css collapse.
            `aria-busy` above is what actually reports the state (rule 9). */}
        {loading && <Loader2 className="h-4 w-4 motion-safe:animate-spin" />}
        <Slottable>{loading && asChild ? null : children}</Slottable>
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }