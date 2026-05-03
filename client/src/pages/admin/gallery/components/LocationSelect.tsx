import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { LOCATIONS } from "@/lib/constants"

interface LocationSelectProps {
  value: string | undefined
  onChange: (location: string | undefined) => void
}

export function LocationSelect({ value, onChange }: LocationSelectProps) {
  const [open, setOpen] = React.useState(false)

  function handleSelect(location: string) {
    onChange(location)
    setOpen(false)
  }

  function handleClear() {
    onChange(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* 药丸形触发按钮：有值时显示地点，无值时显示占位文案 */}
      <PopoverTrigger asChild>
        <button
          className="w-fit rounded-full px-3 py-1 text-xs flex items-center gap-1 cursor-pointer"
          style={{ background: "var(--shelf)", color: "var(--ink-faded)" }}
        >
          <span>📍</span>
          <span>{value ?? "添加地点"}</span>
          <span>▾</span>
        </button>
      </PopoverTrigger>

      {/* 下拉面板：固定 160px 宽，左对齐 */}
      <PopoverContent
        className="p-0"
        style={{ width: 160 }}
        align="start"
      >
        <Command>
          <CommandList>
            <CommandGroup>
              {/* 有选中值时，在顶部提供清除选项 */}
              {value !== undefined && (
                <CommandItem
                  onSelect={handleClear}
                  className="text-xs"
                  style={{ color: "var(--ink-faded)" }}
                >
                  清除
                </CommandItem>
              )}
              {LOCATIONS.map((location) => (
                <CommandItem
                  key={location}
                  value={location}
                  onSelect={() => handleSelect(location)}
                  className="text-xs"
                >
                  {/* 已选中项显示 ✓ 前缀 */}
                  {value === location ? "✓ " : ""}
                  {location}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
