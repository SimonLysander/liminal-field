/**
 * SelectionHint — 编辑器选中文本的提示条。
 *
 * 当用户在编辑器中选中了文字时显示此组件：
 *   - "已选中 N 字" 标签 pill
 *   - 选中文本的截断预览（最多 60 字）
 *
 * 无选中时返回 null，不占位。
 */

interface SelectionHintProps {
  selectedText?: string;
}

export function SelectionHint({ selectedText }: SelectionHintProps) {
  if (!selectedText) return null;

  const charCount = selectedText.length;
  // 超过 60 字截断并加省略号
  const preview = charCount > 60 ? selectedText.slice(0, 60) + '…' : selectedText;

  return (
    <div className="mb-2 flex flex-col gap-1">
      {/* 字数标签 */}
      <span
        className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink-faded)',
          border: '1px solid var(--separator)',
        }}
      >
        已选中 {charCount} 字
      </span>

      {/* 文本预览 */}
      <p
        className="line-clamp-2 text-xs leading-relaxed"
        style={{
          color: 'var(--ink-ghost)',
          fontStyle: 'italic',
        }}
        title={selectedText}
      >
        "{preview}"
      </p>
    </div>
  );
}
