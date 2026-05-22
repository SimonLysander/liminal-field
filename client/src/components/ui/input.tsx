import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 设计系统:透明淡底、无常驻边框,focus 走全局 1px accent 细边(见 index.css),hover 浮淡底
          "flex h-9 w-full rounded-md border border-transparent bg-[var(--shelf)] px-3 py-1 text-md transition-colors placeholder:text-[var(--ink-ghost)] hover:bg-[var(--hover-overlay)] focus-visible:bg-[var(--paper)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
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
