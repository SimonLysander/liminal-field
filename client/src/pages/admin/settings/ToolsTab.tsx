/*
 * ToolsTab — 全局工具一览(只读)
 *
 * 工具是 agent 能调用的能力单元(remember / web_search / propose_caption ...),
 * 由后端代码定义(server/src/modules/agent/tools/*.tool.ts),不在 Mongo 里,
 * 也不让管理员从 UI 编辑——加新工具是工程师的事,跟着代码走。
 *
 * 这页只做"清单展示":显示中文名 + slug + 一句话用途,
 * 让管理员在配置 Agent 工具池 / Skill 必需工具前,看清楚一共有什么。
 *
 * 视觉跟 SkillsTab 的 SkillRow 同款(card 行内、不卡片 hover 点击)。
 * 数据契约:GET /settings/agent-configs/tool-catalog → ToolCatalogEntry[]
 */

import { useCallback, useEffect, useState } from 'react';
import { banner } from '@/components/ui/banner-api';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/services/settings';
import type { ToolCatalogEntry } from '@/services/settings';

/** 单行工具:中文名 + slug 副标 + 一句话描述 */
function ToolRow({ tool }: { tool: ToolCatalogEntry }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-4 py-3"
      style={{
        background: 'var(--paper-dark)',
        border: '0.5px solid var(--separator)',
      }}
    >
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
          title={tool.description}
        >
          {tool.description}
        </p>
      </div>
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
          技能的「必需工具」和 Agent 的「启用工具」都从这里选。
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
