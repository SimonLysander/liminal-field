/**
 * MessageList — 消息列表，自动滚动到底部。
 *
 * 空状态由父组件 AiAdvisorPanel 负责，此组件只负责渲染有消息时的列表。
 */

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { ChatMessage } from './ChatMessage';

interface MessageListProps {
  messages: UIMessage[];
  status: string;
  sessionKey?: string;
  /** 舒适密度(全页 agent);默认紧凑(侧栏) */
  comfortable?: boolean;
}

export function MessageList({ messages, status, sessionKey, comfortable }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  return (
    <div className={`flex flex-1 flex-col overflow-y-auto py-6 ${comfortable ? 'gap-6 px-1' : 'gap-5 px-4'}`}>
      {messages.map((msg) => {
        const textContent = msg.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('');

        return (
          <ChatMessage
            key={msg.id}
            role={msg.role as 'user' | 'assistant'}
            content={textContent}
            parts={msg.role === 'assistant' ? msg.parts : undefined}
            sessionKey={sessionKey}
            comfortable={comfortable}
          />
        );
      })}

      {/* 处理中状态指示 */}
      {(status === 'streaming' || status === 'submitted') && (
        <div
          className="flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--ink-ghost)' }}
        >
          <span
            style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
          >
            ✦
          </span>
          <span>处理中</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
