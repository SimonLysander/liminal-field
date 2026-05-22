/**
 * ChatInput — 裸输入框 + 发送按钮。
 *
 * 外壳（圆角、背景、边框）由父组件 AiAdvisorPanel 提供，
 * 本组件只负责文本输入和发送交互。
 *
 * Enter 发送，Shift+Enter 换行。
 */

import TextareaAutosize from 'react-textarea-autosize';
import { ArrowUp } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const isEmpty = value.trim().length === 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isEmpty && !disabled) onSend();
    }
  }

  return (
    <>
      <TextareaAutosize
        minRows={1}
        maxRows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="聊点什么..."
        className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-[var(--ink-ghost)]"
        style={{
          color: 'var(--ink)',
          lineHeight: 1.6,
          opacity: disabled ? 0.5 : 1,
        }}
      />

      <button
        onClick={onSend}
        disabled={isEmpty || disabled}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-200"
        style={{
          background: isEmpty || disabled ? 'transparent' : 'var(--accent)',
          color: isEmpty || disabled ? 'var(--ink-ghost)' : 'var(--accent-contrast)',
          cursor: isEmpty || disabled ? 'default' : 'pointer',
        }}
        aria-label="发送"
      >
        <ArrowUp size={13} strokeWidth={2.5} />
      </button>
    </>
  );
}
