import { CopyPageButton } from '@/components/shared/CopyPageButton';
import PlateReadOnly from '@/components/shared/PlateReadOnly';
import { AlertCircle, Circle, RotateCcw, Sparkles } from 'lucide-react';

import type { LearnPlan } from '@/services/workspace';

function learnPlanToMarkdown(plan: LearnPlan): string {
  const sections: string[] = [];
  if (plan.understanding.trim()) sections.push(plan.understanding.trim());
  if (plan.items.length > 0) {
    sections.push(
      [
        '## 脉络提案',
        ...plan.items.map((item, index) =>
          [
            `${index + 1}. ${item.title}`,
            item.thread ? `   - 线索: ${item.thread}` : '',
            item.why ? `   - 理由: ${item.why}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ].join('\n'),
    );
  }
  if (plan.conclusion.trim()) sections.push(plan.conclusion.trim());
  return sections.join('\n\n');
}

export function PlanProduct({
  plan,
  title,
  error,
  onRetry,
  onPlanWithAurora,
}: {
  plan: LearnPlan | null;
  title: string;
  error?: string | null;
  onRetry?: () => void;
  onPlanWithAurora: () => void;
}) {
  if (!plan && error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <AlertCircle size={20} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
        <div className="space-y-1.5">
          <p
            className="text-md font-light"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            学习规划加载失败
          </p>
          <p className="text-sm" style={{ color: 'var(--ink-faded)' }}>
            {error}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm outline-none transition-colors hover:bg-[var(--shelf)]"
          style={{ borderColor: 'var(--separator)', color: 'var(--ink)' }}
        >
          <RotateCcw size={14} strokeWidth={1.8} /> 重新加载
        </button>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <Circle size={20} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
        <div className="space-y-1.5">
          <p
            className="text-md font-light"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            还没有规划
          </p>
          <p className="text-sm" style={{ color: 'var(--ink-faded)' }}>
            让 Aurora 研究这个主题，整理一份开篇与学习脉络供你参考。
          </p>
        </div>
        <button
          onClick={onPlanWithAurora}
          className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        >
          <Sparkles size={14} strokeWidth={1.8} /> 让 Aurora 规划
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[38rem] px-8 pb-20 pt-6">
      {error && (
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--separator)', color: 'var(--ink-faded)' }}
        >
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="shrink-0" style={{ color: 'var(--ink)' }}>
            重新加载
          </button>
        </div>
      )}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-2xl font-semibold leading-snug"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {title}
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            Aurora 的学习规划
          </p>
        </div>
        <CopyPageButton
          page={{
            bodyMarkdown: learnPlanToMarkdown(plan),
            metadata: [
              { key: 'scope', label: '范围', value: 'learning' },
              { key: 'goal', label: '概要', value: plan.goal },
              { key: 'item_count', label: '条目数', value: plan.items.length },
            ],
            source: 'learning_plan',
            title: `${title} · 学习规划`,
          }}
        />
      </div>
      {plan.goal && (
        <div
          className="mb-5 flex items-baseline gap-2.5 pb-4"
          style={{ borderBottom: '1px solid var(--separator)' }}
        >
          <span
            className="shrink-0 text-2xs uppercase"
            style={{ color: 'var(--ink-faded)', letterSpacing: '0.06em' }}
          >
            概要
          </span>
          <span
            className="text-md"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {plan.goal}
          </span>
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-faded)' }}>
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' }}
        />
        <span>
          <b style={{ color: 'var(--ink)' }}>Aurora 的理解</b> · 研究后
        </span>
      </div>
      <div
        className="text-md"
        style={{ fontFamily: 'var(--font-serif)', lineHeight: 'var(--leading-reading, 1.75)' }}
      >
        <PlateReadOnly markdown={plan.understanding} />
      </div>

      {plan.items.length > 0 && (
        <>
          <div className="mb-1 mt-7">
            <span
              className="text-2xs uppercase"
              style={{ color: 'var(--ink-faded)', letterSpacing: '0.06em' }}
            >
              脉络 · 提案
            </span>
          </div>
          <div className="relative">
            <span
              className="absolute left-[60px] top-[18px] bottom-6 w-px"
              style={{ background: 'var(--separator)' }}
            />
            {plan.items.map((p, i) => {
              const prevThread = i > 0 ? plan.items[i - 1].thread : undefined;
              const showThread = p.thread !== prevThread;
              return (
                <div
                  key={i}
                  className="grid w-full items-start py-2.5"
                  style={{ gridTemplateColumns: '48px 24px 1fr' }}
                >
                  <div
                    className="flex justify-end pr-2 pt-[3px] text-2xs"
                    style={{
                      color: showThread ? 'var(--ink-faded)' : 'transparent',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {p.thread}
                  </div>
                  <div className="relative flex justify-center pt-[7px]">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: 'var(--accent)', boxShadow: '0 0 0 4px var(--paper)' }}
                    />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="tabular-nums text-xs" style={{ color: 'var(--ink-ghost)' }}>
                        {i + 1}
                      </span>
                      <span
                        className="text-md"
                        style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
                      >
                        {p.title}
                      </span>
                    </div>
                    {p.why && (
                      <p
                        className="mt-0.5 text-xs"
                        style={{ color: 'var(--ink-faded)', lineHeight: 1.65 }}
                      >
                        {p.why}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {plan.conclusion.trim() && (
        <div
          className="mt-8 text-md"
          style={{ fontFamily: 'var(--font-serif)', lineHeight: 'var(--leading-reading, 1.75)' }}
        >
          <PlateReadOnly markdown={plan.conclusion} />
        </div>
      )}
    </div>
  );
}
