import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, style, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer size-4 shrink-0 rounded-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    style={{
      border: '1.5px solid var(--ink-ghost)',
      background: 'transparent',
      ...style,
    }}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className="grid place-content-center"
      style={{ color: 'var(--ink)' }}
    >
      <Check className="size-3.5" strokeWidth={2.5} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
