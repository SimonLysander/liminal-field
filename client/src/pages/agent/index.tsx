/**
 * AgentPage — Lux 全页总助手(全局对话,不绑定具体文档)。
 *
 * 复用编辑器侧栏的对话核心 useAdvisorChat;本页只负责全页布局 + 输入。
 * (右侧"洞察/关联文稿"分析面板是独立功能,待后端就绪后再加。)
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
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

export default function AgentPage() {
  const [input, setInput] = useState('');
  const { messages, status, isStreaming, sessionReady, tier, cycleTier, send } =
    useAdvisorChat({
      sessionKey: SESSION_KEY,
      agentKey: 'writing-advisor',
      source: 'agent-page',
    });

  const isEmpty = input.trim().length === 0;
  const TierIcon = TIER_ICON[tier];

  function handleSend() {
    if (isEmpty || isStreaming) return;
    send(input);
    setInput('');
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col overflow-hidden">
        {/* 对话区 / 空态 */}
        <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-8">
          {!sessionReady ? null : messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 pb-16">
              {/* hero 图标 */}
              <motion.div
                className="relative flex h-14 w-14 items-center justify-center"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, ease: appleEase }}
              >
                <div
                  className="absolute -inset-2 rounded-full"
                  style={{ background: 'radial-gradient(circle, var(--shelf) 0%, transparent 70%)' }}
                />
                <Sparkles
                  size={24}
                  strokeWidth={1.5}
                  className="relative"
                  style={{ color: 'var(--ink-faded)' }}
                />
              </motion.div>
              <div className="flex flex-col items-center gap-1.5">
                <h1 className="text-3xl font-semibold" style={{ color: 'var(--ink)' }}>
                  Lux 助手
                </h1>
                <p className="text-lg" style={{ color: 'var(--ink-ghost)' }}>
                  聊聊你的创作，理思路、找关联
                </p>
              </div>
              {/* 建议气泡 */}
              <div className="mt-1 flex flex-wrap justify-center gap-2">
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
          ) : (
            <MessageList messages={messages} status={status} sessionKey={SESSION_KEY} />
          )}
        </div>

        {/* 输入栏 */}
        <div className="shrink-0 px-6 pb-7 pt-2">
          <div
            className="flex items-end gap-2 rounded-xl px-3.5 py-2.5"
            style={{ background: 'var(--shelf)' }}
          >
            {/* Tier 切换 */}
            <button
              onClick={cycleTier}
              disabled={isStreaming}
              title={`${TIER_LABEL[tier]}（点击切换）`}
              className="mb-px shrink-0 transition-colors duration-150 disabled:opacity-40"
              style={{ color: 'var(--ink-ghost)' }}
            >
              <TierIcon size={16} strokeWidth={1.5} />
            </button>

            <TextareaAutosize
              minRows={1}
              maxRows={8}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isStreaming}
              placeholder="向 Lux 提问..."
              className="flex-1 resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-[var(--ink-ghost)]"
              style={{ color: 'var(--ink)', opacity: isStreaming ? 0.5 : 1 }}
            />

            <button
              onClick={handleSend}
              disabled={isEmpty || isStreaming}
              aria-label="发送"
              className="mb-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:cursor-default"
              style={{
                background: isEmpty || isStreaming ? 'transparent' : 'var(--accent)',
                color: isEmpty || isStreaming ? 'var(--ink-ghost)' : 'var(--accent-contrast)',
              }}
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
