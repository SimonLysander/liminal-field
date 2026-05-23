import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Notion 紧凑:高 28、圆角小、透明淡底,focus 走全局 1px accent 细边,hover 浮淡底
          "flex h-7 w-full rounded-sm border border-transparent bg-[var(--shelf)] px-2 text-md transition-colors placeholder:text-[var(--ink-ghost)] hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
