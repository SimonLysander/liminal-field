import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 紧凑表单 input：idle bg-shelf 浅灰；hover / focus 由全局 input
          // 视觉规范驱动 (hover-overlay → accent-soft)，不在 class 里重复，
          // 避免局部覆盖全局规范、保持所有 input 视觉统一。
          "flex h-7 w-full rounded-sm border border-transparent bg-[var(--shelf)] px-2.5 text-md transition-colors placeholder:text-[var(--ink-ghost)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
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
