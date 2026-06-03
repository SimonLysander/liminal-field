/*
 * ToolsTab — 全局工具一览(只读)
 *
 * 工具是 agent 能调用的能力单元(remember / web_search / propose_caption ...),
 * 由后端代码定义(server/src/modules/agent/tools/*.tool.ts),不在 Mongo 里,
 * 也不让管理员从 UI 编辑——加新工具是工程师的事,跟着代码走。
 *
 * 这页是工具的"说明书":默认每个工具一行紧凑展示(displayName + slug + summary),
 * 点击行展开详情(detail 段落 + 输入参数表 + 返回结果)。
 *
 * 视觉跟 SkillsTab 的 SkillRow 同款(card 行内、明确按钮、不卡片 hover 点击)。
 * 数据契约:GET /settings/agent-configs/tool-catalog → ToolCatalogEntry[]
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/services/settings';
import type { ToolCatalogEntry } from '@/services/settings';

/**
 * 单行工具:默认紧凑,点击展开详情区。
 *
 * 折叠态:displayName + slug + summary,跟 SkillRow 同视觉
 * 展开态:多加 detail 段落 + 输入参数表 + 返回结果说明
 */
function ToolRow({ tool }: { tool: ToolCatalogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      className="rounded-lg"
      style={{
        background: 'var(--paper-dark)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {/* 折叠头:整行可点(显式 button,不靠 card hover) */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors duration-100 hover:bg-[var(--shelf)]"
      >
        <span
          className="shrink-0"
          style={{ color: 'var(--ink-faded)' }}
          aria-hidden
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {tool.displayName}
            </span>
            <span
              className="font-mono text-2xs"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {tool.name}
            </span>
          </div>
          <p
            className="mt-0.5 truncate text-xs"
            style={{ color: 'var(--ink-faded)' }}
            title={tool.summary}
          >
            {tool.summary}
          </p>
        </div>
      </button>

      {/* 展开详情:detail 段落 + 参数表 + 返回 */}
      {expanded && (
        <div
          className="space-y-4 px-4 pb-4"
          style={{ borderTop: '0.5px solid var(--separator)' }}
        >
          <section className="pt-3">
            <SectionLabel>说明</SectionLabel>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--ink)' }}
            >
              {tool.detail}
            </p>
          </section>

          <section>
            <SectionLabel>输入参数</SectionLabel>
            {tool.params.length === 0 ? (
              <p
                className="text-xs italic"
                style={{ color: 'var(--ink-ghost)' }}
              >
                无入参
              </p>
            ) : (
              <ul className="space-y-2">
                {tool.params.map((p) => (
                  <li
                    key={p.name}
                    className="rounded-md px-3 py-2"
                    style={{ background: 'var(--shelf)' }}
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <code
                        className="font-mono text-xs"
                        style={{ color: 'var(--ink)' }}
                      >
                        {p.name}
                      </code>
                      <span
                        className="text-2xs"
                        style={{ color: 'var(--ink-ghost)' }}
                      >
                        {p.type}
                      </span>
                      {p.required ? (
                        <span
                          className="rounded px-1 text-2xs"
                          style={{
                            color: 'var(--danger)',
                            background: 'rgba(190, 70, 70, 0.08)',
                          }}
                        >
                          必填
                        </span>
                      ) : (
                        <span
                          className="text-2xs"
                          style={{ color: 'var(--ink-ghost)' }}
                        >
                          可选
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: 'var(--ink-faded)' }}
                    >
                      {p.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionLabel>返回</SectionLabel>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--ink)' }}
            >
              {tool.returns}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

/** 详情区里的小标题(说明 / 输入参数 / 返回) */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1.5 text-2xs uppercase tracking-wider"
      style={{ color: 'var(--ink-ghost)' }}
    >
      {children}
    </div>
  );
}

export function ToolsTab() {
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await settingsApi.getToolCatalog();
      setTools(list);
    } catch {
      banner.error('加载工具清单失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="font-serif text-2xl"
          style={{ color: 'var(--ink)', fontVariantNumeric: 'oldstyle-nums' }}
        >
          工具
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          Agent 能调用的能力单元。由代码定义,管理员只查看不编辑;
          技能的「必需工具」和 Agent 的「启用工具」都从这里选。点击行可展开看完整参数和返回结构。
        </p>
      </div>

      <Separator />

      <section className="space-y-2">
        {loading ? (
          <div
            className="h-16 animate-pulse rounded-lg"
            style={{ background: 'var(--shelf)' }}
          />
        ) : tools.length > 0 ? (
          tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
        ) : (
          <div
            className="rounded-lg px-3 py-6 text-center text-xs"
            style={{
              color: 'var(--ink-ghost)',
              border: '1px dashed var(--separator)',
            }}
          >
            工具清单为空。
          </div>
        )}
      </section>
    </div>
  );
}
