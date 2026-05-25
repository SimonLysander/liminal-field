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
  /** sub_agent 执行中实时步骤需要 sessionKey(透传给 ChatMessage → ToolCallCard) */
  sessionKey?: string;
  /** 舒适密度(全页 agent);默认紧凑(侧栏) */
  comfortable?: boolean;
  /** 对话出错(请求失败/模型报错等),显示出来,不静默 */
  error?: Error;
}

export function MessageList({
  messages,
  status,
  sessionKey,
  comfortable,
  error,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  // 智能贴底:新消息(含初次加载)直接到底;流式增量仅当用户已在底部附近时才平滑跟随,
  // 用户主动上滚回看时不强行拉回。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNewMessage = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNewMessage || nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: isNewMessage ? 'auto' : 'smooth' });
    }
  }, [messages, status]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 flex-col overflow-y-auto py-6 ${comfortable ? 'gap-6 px-1' : 'gap-5 px-4'}`}
      style={{
        // 上下边缘渐隐:内容滚到顶/底时柔和淡出,不硬切
        maskImage:
          'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
      }}
    >
      {messages.map((msg) => {
        const textContent = msg.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('');

        return (
          // 外层承载「凝聚」入场动画 + 稳定 key(流式更新不重放,见 index.css .agent-msg-enter)
          <div key={msg.id} className="agent-msg-enter">
            <ChatMessage
              role={msg.role as 'user' | 'assistant'}
              content={textContent}
              parts={msg.role === 'assistant' ? msg.parts : undefined}
              sessionKey={sessionKey}
              comfortable={comfortable}
            />
          </div>
        );
      })}

      {/* 思考中 = 鸢尾草木生长循环(种子→花苞→半开→盛放→再生),草木纸艺 §3.3 + 箴言"将生未生→生长"。 */}
      {(status === 'streaming' || status === 'submitted') && (
        <div
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--ink-faded)' }}
        >
          {/* 草木生长循环:种子→花苞→半开→盛放→淡出→再生(鸢尾纸艺;§3.3 + 箴言"将生未生→生长") */}
          <div className="grow-loop" aria-hidden>
            <img className="gs-seed" src="/garden/iris-seed.webp" alt="" draggable={false} />
            <img className="gs-bud" src="/garden/iris-bud.webp" alt="" draggable={false} />
            <img className="gs-half" src="/garden/iris-half.webp" alt="" draggable={false} />
            <img className="gs-bloom" src="/garden/iris-bloom.webp" alt="" draggable={false} />
          </div>
          <span>凝思中</span>
        </div>
      )}

      {/* 出错显示(不静默):请求失败 / 模型报错等 */}
      {error && (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            color: 'var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          }}
        >
          出错了:{error.message || '请稍后重试'}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
