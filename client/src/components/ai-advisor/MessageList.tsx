/**
 * MessageList — 消息列表，自动滚动到底部 + 滚到顶懒加载更早历史。
 *
 * 空状态由父组件 AiAdvisorPanel 负责，此组件只负责渲染有消息时的列表。
 *
 * 懒加载设计（U7 新增）：
 * - 顶部放一个哨兵 div，用 IntersectionObserver 检测用户是否滚到顶
 * - 进入视口时调用 onLoadMore，避免轮询，性能友好
 * - 加载期间显示 spinner 防止重复触发（isLoadingMore 由父控制）
 */

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { AiEditOutcome } from '@/pages/admin/lib/apply-ai-edit';
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
  /** 是否还有更早的历史（显示顶部加载触发区） */
  hasMore?: boolean;
  /** 是否正在加载更早历史 */
  isLoadingMore?: boolean;
  /** 触发加载更早历史（滚到顶时调用） */
  onLoadMore?: () => void;
  /**
   * v2 改稿 outcomes 索引:key = toolCallId,value = AiEditOutcome。
   * 透传给 ChatMessage,卡片按 part.toolCallId 精确匹配,失败时标红。
   */
  outcomesByCallId?: Record<string, AiEditOutcome>;
}

export function MessageList({
  messages,
  status,
  sessionKey,
  comfortable,
  error,
  hasMore,
  isLoadingMore,
  onLoadMore,
  outcomesByCallId,
}: MessageListProps) {
  const edgeFadeMask =
    'linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)';
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 顶部哨兵：IntersectionObserver 检测用户是否滚到顶，触发懒加载
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  // 智能贴底:新消息(含初次加载)直接到底;流式增量仅当用户已在底部附近时才平滑跟随,
  // 用户主动上滚回看时不强行拉回。
  // prepend 旧消息时 messages.length 增大但方向是向上，不触发贴底（nearBottom=false）。
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

  // 顶部哨兵：用户滚到顶时触发懒加载，IntersectionObserver 避免轮询
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || !onLoadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoadingMore) {
          onLoadMore();
        }
      },
      {
        root: containerRef.current,
        // 提前 40px 进入视口即触发，滚动体验更顺滑
        rootMargin: '40px 0px 0px 0px',
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 flex-col overflow-y-auto py-6 ${comfortable ? 'gap-6 px-1' : 'gap-5 px-4'}`}
      style={{
        // 上下边缘渐隐:内容滚到顶/底时柔和淡出,不硬切
        maskImage: edgeFadeMask,
        WebkitMaskImage: edgeFadeMask,
      }}
    >
      {/* 顶部哨兵 + 加载指示器：有更早历史时渲染，IntersectionObserver 触发懒加载 */}
      {hasMore && (
        <div ref={topSentinelRef} className="flex justify-center pb-2 pt-1">
          {isLoadingMore ? (
            <span
              className="text-xs"
              style={{ color: 'var(--ink-ghost)' }}
            >
              加载中…
            </span>
          ) : (
            // 哨兵占位（不可见，observer 用），用户上滚时自动进入视口触发
            <span className="sr-only">加载更早历史</span>
          )}
        </div>
      )}

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
              outcomesByCallId={outcomesByCallId}
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
