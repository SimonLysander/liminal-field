/**
 * AgentPage — Lux 全页总助手(全局对话,不绑定具体文档)。
 *
 * 布局参照 Claude 聊天页、融入纸墨 + 长春花紫设计语言:
 * - 空态:问候 + 输入框【居中落地】,发消息后输入框移到底部
 * - 输入框:带边框的纸面圆角盒子(textarea 在上,底部一行 tier 选择 + 发送)
 * - 消息:comfortable 大字距,居中阅读列
 *
 * 复用编辑器侧栏的对话核心 useAdvisorChat;不重复造。
 * (右侧"洞察/关联文稿"分析面板是独立功能,待后端就绪后再加。)
 */
import { useState } from 'react';
import { Sparkles, Zap, Brain, ArrowUp } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import { MessageList } from '@/components/ai-advisor/MessageList';
import { useAdvisorChat, type Tier } from '@/components/ai-advisor/use-advisor-chat';

const TIER_ICON: Record<Tier, typeof Sparkles> = {
  flash: Zap,
  standard: Sparkles,
  think: Brain,
};
const TIER_LABEL: Record<Tier, string> = {
  flash: '闪电',
  standard: '标准',
  think: '深思',
};

const SUGGESTIONS = ['这周写了些什么', '帮我理理思路', '有没有可参考的旧文', '接下来写点什么好'];
const SESSION_KEY = 'agent-page';

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '上午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** Claude 式输入框:纸面圆角盒,textarea 在上、底部一行 tier + 发送。 */
function Composer({
  input,
  setInput,
  onSend,
  tier,
  cycleTier,
  isStreaming,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  tier: Tier;
  cycleTier: () => void;
  isStreaming: boolean;
}) {
  const isEmpty = input.trim().length === 0;
  const TierIcon = TIER_ICON[tier];
  return (
    <div
      className="rounded-xl border"
      style={{ background: 'var(--paper)', borderColor: 'var(--separator)' }}
    >
      <TextareaAutosize
        minRows={1}
        maxRows={10}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        disabled={isStreaming}
        placeholder="给 Lux 发消息..."
        className="w-full resize-none bg-transparent px-4 pt-3 text-base leading-relaxed outline-none placeholder:text-[var(--ink-ghost)]"
        style={{ color: 'var(--ink)', opacity: isStreaming ? 0.6 : 1 }}
      />
      <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
        {/* tier 选择(点击循环) */}
        <button
          onClick={cycleTier}
          disabled={isStreaming}
          title="思考档位(点击切换)"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--shelf)] disabled:opacity-40"
          style={{ color: 'var(--ink-faded)' }}
        >
          <TierIcon size={14} strokeWidth={1.5} />
          {TIER_LABEL[tier]}
        </button>
        {/* 发送 */}
        <button
          onClick={onSend}
          disabled={isEmpty || isStreaming}
          aria-label="发送"
          className="flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 disabled:cursor-default"
          style={{
            background: isEmpty || isStreaming ? 'var(--shelf)' : 'var(--accent)',
            color: isEmpty || isStreaming ? 'var(--ink-ghost)' : 'var(--accent-contrast)',
          }}
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const [input, setInput] = useState('');
  const [greeting] = useState(timeGreeting);
  const { messages, status, isStreaming, sessionReady, tier, cycleTier, send } =
    useAdvisorChat({
      sessionKey: SESSION_KEY,
      agentKey: 'writing-advisor',
      source: 'agent-page',
    });

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    send(input);
    setInput('');
  }

  const composerProps = { input, setInput, onSend: handleSend, tier, cycleTier, isStreaming };

  if (!sessionReady) return <div className="flex-1" />;

  // ── 落地态:问候 + 输入框居中 ──
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-24 pt-10">
        <div className="flex w-full max-w-[680px] flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <Sparkles size={28} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
            <h1 className="text-4xl font-semibold" style={{ color: 'var(--ink)' }}>
              {greeting}
            </h1>
            <p className="text-lg" style={{ color: 'var(--ink-ghost)' }}>
              聊聊你的创作，理思路、找关联
            </p>
          </div>
          <div className="w-full">
            <Composer {...composerProps} />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={isStreaming}
                className="rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-[var(--shelf)] disabled:opacity-40"
                style={{ color: 'var(--ink-faded)', borderColor: 'var(--separator)' }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── 对话态:消息滚动 + 输入框固定底部 ──
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col overflow-hidden">
        <MessageList messages={messages} status={status} sessionKey={SESSION_KEY} comfortable />
      </div>
      <div className="mx-auto w-full max-w-[760px] shrink-0 px-6 pb-6 pt-2">
        <Composer {...composerProps} />
      </div>
    </div>
  );
}
