import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { ArrowUp, Sparkles as SparklesIcon } from 'lucide-react';

/* ---------- Mock Data ---------- */

const suggestions = ['分析写作模式', '查找文稿关联', '总结本周创作', '推荐下一步'];

interface Block {
  type: 'text' | 'quote' | 'cards';
  text?: string;
  items?: { num: number; title: string; desc: string; notes: string[] }[];
}

interface Message {
  role: 'agent' | 'user';
  blocks: Block[];
}

const conversation: Message[] = [
  { role: 'agent', blocks: [{ type: 'text', text: '我分析了你最近的 11 篇文稿和 47 张图片，发现了一些有趣的模式。' }] },
  { role: 'agent', blocks: [{ type: 'text', text: '「通感」是你反复出现的核心主题。在 4 篇文稿中，你从不同角度探索了感官越境的概念 —— 声音的形状、颜色与记忆的关联、阈限空间中的感知状态。' }] },
  { role: 'user', blocks: [{ type: 'text', text: '这些文稿之间有什么交叉点吗？' }] },
  {
    role: 'agent',
    blocks: [
      { type: 'text', text: '主要有三组关联：' },
      {
        type: 'cards',
        items: [
          { num: 1, title: '边界感知', desc: '「阈限空间里的创作方法论」与「通感笔记：前言」共享了对边界感知的讨论 —— 两篇都在探索确定性与不确定性之间的创作状态。', notes: ['阈限空间里的创作方法论', '通感笔记：前言'] },
          { num: 2, title: '感官越境', desc: '「声音的形状」与「关于颜色与记忆」使用了相似的感官越境概念，但前者侧重听觉→视觉，后者侧重视觉→情感。', notes: ['声音的形状', '关于颜色与记忆'] },
          { num: 3, title: '方法论自洽', desc: '「反向日记」的方法论可以追溯到「不确定性笔记」中的理论框架 —— 你在无意中形成了一套自洽的创作方法论。', notes: ['反向日记', '不确定性笔记'] },
        ],
      },
    ],
  },
  { role: 'user', blocks: [{ type: 'text', text: '第三点很有意思，我之前没有意识到这种关联。能展开说说吗？' }] },
  {
    role: 'agent',
    blocks: [
      { type: 'text', text: '你在「不确定性笔记」中写道：' },
      { type: 'quote', text: '确定性是创造力的天敌。' },
      { type: 'text', text: '而在「反向日记」中，你提出的方法本质上就是在实践这个理念 —— 通过从结果倒推过程，强迫自己放弃线性思维的确定感。' },
      { type: 'text', text: '这不是巧合，这是你的创作直觉在不同文本中反复确认同一个洞察。' },
    ],
  },
];

const insights = [
  { label: '核心主题', value: '通感 · 阈限 · 不确定性', sub: undefined, strength: 92 },
  { label: '活跃主题', value: '边界感知', sub: '近 30 天出现 7 次', strength: 78 },
  { label: '写作模式', value: '理论 → 体验 → 方法论', sub: '三段式结构', strength: 85 },
  { label: '图文关联', value: '青岛系列 × 扁平光', sub: '4 张照片 · 2 篇文稿', strength: 71 },
];

const relatedNotes = [
  { title: '阈限空间里的创作方法论', match: 92 },
  { title: '通感笔记：前言', match: 87 },
  { title: '不确定性笔记', match: 76 },
  { title: '反向日记', match: 71 },
];

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.1 + i * 0.07, duration: 0.5, ease: appleEase },
  }),
};

/* ---------- Component ---------- */

export default function AgentPage() {
  const [input, setInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, []);

  return (
    <div className="flex flex-1 items-stretch overflow-hidden">
      {/* Center — conversation */}
      <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-10 pb-8 pt-6" ref={chatRef}>
          {/* Hero greeting */}
          <div className="flex flex-col items-center gap-3 pb-11 pt-12">
            {/* Glow icon */}
            <motion.div
              className="relative mb-1 flex h-14 w-14 items-center justify-center"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: appleEase }}
            >
              <div
                className="absolute -inset-2 rounded-full"
                style={{ background: 'radial-gradient(circle, var(--shelf) 0%, transparent 70%)', animation: 'glow-pulse 3s ease-in-out infinite' }}
              />
              <SparklesIcon className="relative z-[1]" size={24} strokeWidth={1.5} style={{ color: 'var(--ink-faded)' }} />
            </motion.div>

            <motion.h1
              className="text-3xl font-semibold"
              style={{ color: 'var(--ink)', letterSpacing: '-0.025em' }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              Liminal Field 助手
            </motion.h1>
            <motion.p
              className="text-lg"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '-0.003em' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.5 }}
            >
              分析你的创作模式，发现隐藏的关联
            </motion.p>

            {/* Suggestion chips */}
            <motion.div
              className="mt-2 flex flex-wrap justify-center gap-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4 }}
            >
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className="hover-shelf hover-ink cursor-pointer rounded-full px-4 py-[7px] text-md transition-all duration-200"
                  style={{
                    color: 'var(--ink-faded)',
                    border: '1px solid var(--box-border)',
                    letterSpacing: '-0.003em',
                  }}
                >
                  {s}
                </button>
              ))}
            </motion.div>
          </div>

          {/* Conversation thread */}
          <div className="mx-auto flex w-full max-w-[600px] flex-col gap-2">
            {conversation.map((msg, i) => (
              <motion.div
                key={i}
                className={`py-1 ${msg.role === 'user' ? 'flex justify-end pb-1 pt-3' : ''}`}
                custom={i}
                initial="hidden"
                animate="show"
                variants={fadeUp}
              >
                {msg.blocks.map((block, j) => {
                  if (block.type === 'text' && msg.role === 'user') {
                    return (
                      <p
                        key={j}
                        className="inline-block max-w-[85%] rounded-[18px] px-4 py-2.5 text-lg leading-relaxed"
                        style={{
                          background: 'var(--shelf)',
                          color: 'var(--ink)',
                          fontWeight: 450,
                          letterSpacing: '-0.003em',
                        }}
                      >
                        {block.text}
                      </p>
                    );
                  }
                  if (block.type === 'text') {
                    return (
                      <p
                        key={j}
                        className="text-lg leading-[1.75]"
                        style={{ color: 'var(--ink-light)', letterSpacing: '-0.003em' }}
                      >
                        {block.text}
                      </p>
                    );
                  }
                  if (block.type === 'quote') {
                    return (
                      <blockquote
                        key={j}
                        className="my-3 border-l-2 py-0 pl-5 text-lg font-medium leading-relaxed"
                        style={{ borderColor: 'var(--ink)', color: 'var(--ink)', letterSpacing: '-0.01em' }}
                      >
                        {block.text}
                      </blockquote>
                    );
                  }
                  if (block.type === 'cards' && block.items) {
                    return (
                      <div key={j} className="my-3.5 flex flex-col gap-2.5">
                        {block.items.map((card, k) => (
                          <div
                            key={k}
                            className="hover-shadow-sm cursor-default rounded-xl p-4 transition-shadow duration-250"
                            style={{ background: 'var(--paper-dark)' }}
                          >
                            <div className="mb-2 flex items-center gap-2.5">
                              <span
                                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                                style={{ background: 'var(--ink)', color: 'var(--accent-contrast)' }}
                              >
                                {card.num}
                              </span>
                              <span
                                className="text-lg font-semibold"
                                style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
                              >
                                {card.title}
                              </span>
                            </div>
                            <p
                              className="mb-2.5 text-md leading-relaxed"
                              style={{ color: 'var(--ink-faded)' }}
                            >
                              {card.desc}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {card.notes.map((n, ni) => (
                                <span
                                  key={ni}
                                  className="rounded-full px-2.5 py-[3px] text-sm"
                                  style={{
                                    color: 'var(--ink-faded)',
                                    background: 'var(--paper)',
                                    border: '0.5px solid var(--separator)',
                                  }}
                                >
                                  {n}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Input bar */}
        <div className="mx-auto w-full max-w-[800px] shrink-0 px-10 pb-7">
          <div className="relative flex items-center">
            <input
              type="text"
              className="focus-border w-full rounded-3xl border px-5 py-3.5 pr-[52px] text-lg outline-none transition-all duration-250"
              style={{
                borderColor: 'var(--box-border)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                fontFamily: 'var(--font-sans)',
                letterSpacing: '-0.003em',
              }}
              placeholder="向 Agent 提问..."
              value={input}
              onChange={(e) => setInput(e.target.value)}


            />
            <button
              className="absolute right-1.5 flex h-[34px] w-[34px] items-center justify-center rounded-full transition-all duration-250"
              style={{
                background: input.trim() ? 'var(--ink)' : 'var(--separator)',
                color: 'var(--accent-contrast)',
                opacity: input.trim() ? 1 : 0.4,
              }}
              disabled={!input.trim()}
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Right panel — insights + related notes */}
      <div
        className="flex shrink-0 flex-col gap-9 overflow-y-auto px-4 py-10"
        style={{ width: 'var(--layout-sidebar)' }}
      >
        {/* Insights */}
        <div className="flex flex-col">
          <div
            className="mb-3 text-sm font-semibold uppercase"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
          >
            洞察
          </div>
          <div className="flex flex-col gap-3">
            {insights.map((ins, i) => (
              <div
                key={i}
                className="hover-shadow-xs flex flex-col gap-1.5 rounded-lg p-3.5 transition-shadow duration-200"
                style={{ background: 'var(--paper-dark)' }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-sm font-semibold uppercase"
                    style={{ color: 'var(--ink-ghost)', letterSpacing: '0.03em' }}
                  >
                    {ins.label}
                  </span>
                  <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
                    {ins.strength}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-[2px] overflow-hidden rounded-sm" style={{ background: 'var(--separator)' }}>
                  <motion.div
                    className="h-full rounded-sm"
                    style={{ background: 'var(--ink)', opacity: 0.5 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${ins.strength}%` }}
                    transition={{ delay: 0.3 + i * 0.1, duration: 0.6, ease: appleEase }}
                  />
                </div>
                <div className="text-md font-medium" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                  {ins.value}
                </div>
                {ins.sub && (
                  <div className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
                    {ins.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Related notes */}
        <div className="flex flex-col">
          <div
            className="mb-3 text-sm font-semibold uppercase"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
          >
            关联文稿
          </div>
          <div className="flex flex-col gap-1.5">
            {relatedNotes.map((note, i) => (
              <div
                key={i}
                className="hover-shelf flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors duration-150"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span className="truncate text-md transition-colors duration-150" style={{ color: 'var(--ink-light)' }}>
                    {note.title}
                  </span>
                  <div className="h-[2px] overflow-hidden rounded-sm" style={{ background: 'var(--separator)' }}>
                    <motion.div
                      className="h-full rounded-sm"
                      style={{ background: 'var(--ink)', opacity: 0.35 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${note.match}%` }}
                      transition={{ delay: 0.5 + i * 0.08, duration: 0.5, ease: appleEase }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
                  {note.match}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
