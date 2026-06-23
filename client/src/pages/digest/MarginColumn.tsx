/*
 * MarginColumn — digest 报告阅读页的「边栏旁注」列(Tufte 派 margin-note 路子)。
 *
 * 固定占据右栏 288px,内容两段:
 *  1. 目录(§1 · §2 · §3 + 当前章节高亮)——scroll spy 联动,点击跳转
 *  2. 本期参考(N 条 findings 索引,citation 编号 + 标题 + 来源 + 外链)
 */

import type { PublicFinding } from '@/services/digest-public';

export interface MarginColumnProps {
  /** 报告章节标题列表(extractSections(markdown) 抽出来) */
  sections: string[];
  /** 本期 findings 索引(顺序按 citationId 升序) */
  findings: PublicFinding[];
  /** scroll spy 命中的当前章节 idx(0-based) */
  activeSection: number;
  /** 点击 §N 跳到正文对应 H2 */
  onScrollToSection: (idx: number) => void;
  /** 预留:外部切换到 Aurora 列（可选，当前不使用） */
  onAskAurora?: () => void;
}

export function MarginColumn({
  sections,
  findings,
  activeSection,
  onScrollToSection,
}: MarginColumnProps) {
  return (
    <div
      className="flex h-full flex-col gap-8 overflow-y-auto px-5 py-6"
      style={{
        fontFamily:
          '"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",Georgia,serif',
      }}
    >
      {/* ── 目录(章节进度)──
          §N 编号用 mono 字体 + ink-ghost,标题 italic,当前节加重并去 opacity */}
      {sections.length > 0 && (
        <section>
          <p
            className="mb-3 text-[10px] uppercase tracking-[0.24em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            目录
          </p>
          <ol className="space-y-2">
            {sections.map((s, idx) => {
              const active = idx === activeSection;
              return (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => onScrollToSection(idx)}
                    className="group block w-full text-left transition-opacity duration-150"
                    style={{
                      color: active ? 'var(--ink)' : 'var(--ink-faded)',
                      opacity: active ? 1 : 0.7,
                    }}
                  >
                    <span
                      className="mr-2 text-[10px]"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--ink-ghost)',
                      }}
                    >
                      §{idx + 1}
                    </span>
                    <span
                      className="text-xs italic leading-snug group-hover:opacity-100"
                      style={{ fontWeight: active ? 500 : 400 }}
                    >
                      {s}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ── 本期参考(findings 旁注列)──
          每条:上标小灰编号 + 《标题》 + italic 来源。点击新标签打开外链。
          这一段是 margin notes 的"杀手锏"——读者看到 [⁴] 时眼球右移即可看到对应注解,
          不用 hover、不用滚到文末。 */}
      <section>
        <p
          className="mb-3 text-[10px] uppercase tracking-[0.24em]"
          style={{ color: 'var(--ink-ghost)' }}
        >
          本期参考 &nbsp;·&nbsp; {findings.length} 条
        </p>
        <ul className="space-y-3.5">
          {findings.map((f) => (
            <li key={f.citationId}>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-baseline gap-1.5 transition-opacity duration-150 hover:opacity-100"
                style={{ opacity: 0.82 }}
              >
                {/* 序号:定宽 + baseline 对齐标题首行(不再 super 上标,避免与标题错位) */}
                <span
                  className="w-3 shrink-0 text-right text-[10px] tabular-nums"
                  style={{ color: 'var(--ink-ghost)', fontWeight: 500 }}
                >
                  {f.citationId}
                </span>
                {/* 标题 + 来源:flex-1,换行与来源都缩进对齐标题首行(hanging indent) */}
                <span className="min-w-0 flex-1">
                  <span
                    className="text-xs leading-snug"
                    style={{ color: 'var(--ink-soft)' }}
                  >
                    《{f.title}》
                  </span>
                  <span
                    className="mt-0.5 block text-[11px] italic leading-snug"
                    style={{ color: 'var(--ink-ghost)' }}
                  >
                    {f.sourceName}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}
