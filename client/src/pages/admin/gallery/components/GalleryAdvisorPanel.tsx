/*
 * GalleryAdvisorPanel — 画廊图说写手 Aurora 的浮层面板。
 *
 * 与笔记/文集的三栏侧栏不同:画廊是单列布局,故做成右下浮层(FAB 开合),不改页面结构。
 * 复用 useAdvisorChat + MessageList;图说建议(propose_caption)在输入框上方以卡片冒出,
 * 点「应用」落到 useGalleryEditor.updateCaption。短文案不做 diff。
 *
 * 仅在配了 visionModel 时由父组件挂载(没视觉模型 agent 看不了图)。
 */
import { useCallback, useRef, useState } from 'react';
import { ArrowUp, Check, MessagesSquare, Square, X } from 'lucide-react';
import { useAdvisorChat } from '@/components/ai-advisor/use-advisor-chat';
import { MessageList } from '@/components/ai-advisor/MessageList';

export interface GalleryAdvisorPhoto {
  fileName: string;
  caption: string;
  tags?: Record<string, string>;
  url: string;
}

interface GalleryAdvisorPanelProps {
  postId: string;
  title: string;
  prose: string;
  photos: GalleryAdvisorPhoto[];
  /** 应用图说到对应照片(= useGalleryEditor.updateCaption) */
  onApplyCaption: (fileName: string, caption: string) => void;
}

export function GalleryAdvisorPanel({
  postId,
  title,
  prose,
  photos,
  onApplyCaption,
}: GalleryAdvisorPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 每个画廊一个稳定会话(无多会话下拉,YAGNI)
  const sessionKey = `gallery:${postId}`;

  const {
    messages,
    status,
    isStreaming,
    sessionReady,
    hasMore,
    isLoadingMore,
    loadMore,
    captionProposals,
    resolveCaption,
    send,
    stop,
    error,
  } = useAdvisorChat({
    sessionKey,
    agentInstanceKey: sessionKey,
    agentKey: 'gallery-caption-writer',
    source: 'gallery-editor',
    galleryContext: {
      contentItemId: postId,
      title,
      prose,
      photos: photos.map((p, i) => ({
        index: i,
        fileName: p.fileName,
        caption: p.caption,
        tags: p.tags ?? {},
      })),
    },
  });

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft('');
    send(text);
  }, [draft, isStreaming, send]);

  const photoByName = useCallback(
    (fileName: string) => photos.find((p) => p.fileName === fileName),
    [photos],
  );

  // 收起时:右下角 FAB
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
        style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        aria-label="打开图说写手"
        title="图说写手 Aurora"
      >
        <MessagesSquare size={20} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-40 flex flex-col overflow-hidden rounded-2xl shadow-2xl"
      style={{
        width: 'min(400px, calc(100vw - 2rem))',
        height: 'min(72vh, 640px)',
        background: 'var(--paper)',
        border: '1px solid var(--separator)',
      }}
    >
      {/* 顶栏 */}
      <div
        className="flex h-12 shrink-0 items-center justify-between px-4"
        style={{ borderBottom: '1px solid var(--separator)' }}
      >
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          图说写手
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1.5 transition-colors hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-ghost)' }}
          aria-label="收起"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* 消息区 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {sessionReady && messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-sm font-light" style={{ color: 'var(--ink-ghost)' }}>
              想聊聊这些照片，还是要我帮忙写图说？
            </p>
          </div>
        )}
        {sessionReady && messages.length > 0 && (
          <MessageList
            messages={messages}
            status={status}
            sessionKey={sessionKey}
            error={error}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
          />
        )}
      </div>

      {/* 图说建议卡片(钉在输入框上方) */}
      {captionProposals.length > 0 && (
        <div
          className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto px-3 py-2"
          style={{ borderTop: '1px solid var(--separator)' }}
        >
          {captionProposals.map((cp) => {
            const photo = photoByName(cp.fileName);
            return (
              <div
                key={cp.callId}
                className="flex items-start gap-2 rounded-lg p-2"
                style={{ background: 'var(--shelf)' }}
              >
                {photo && (
                  <img
                    src={photo.url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug" style={{ color: 'var(--ink)' }}>
                    {cp.caption}
                  </p>
                  {cp.reason && (
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                      {cp.reason}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onApplyCaption(cp.fileName, cp.caption);
                    resolveCaption(cp.callId);
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
                  style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
                  title="应用到这张照片"
                >
                  <Check size={12} strokeWidth={2} />
                  应用
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--shelf)' }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder="比如：给前两张写图说"
            className="max-h-28 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)' }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
              aria-label="停止"
            >
              <Square size={11} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all disabled:cursor-default"
              style={{
                background: draft.trim()
                  ? 'var(--accent)'
                  : 'color-mix(in srgb, var(--ink) 8%, transparent)',
                color: draft.trim() ? 'var(--accent-contrast)' : 'var(--ink-ghost)',
              }}
              aria-label="发送"
            >
              <ArrowUp size={15} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
