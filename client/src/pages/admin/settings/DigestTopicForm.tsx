/**
 * DigestTopicForm — 事项新建/编辑表单
 *
 * 信息源选项从 infoSourcesApi.list() 拉真实数据。
 * 父组件传 initial 时为编辑模式（含 sourceIds / keywords / prompt 等完整字段）。
 */

import { useEffect, useState } from 'react';
import { ChipSelector } from '@/components/shared/ChipSelector';
import { FieldLabel, PrimaryButton, SecondaryButton } from './SettingsUI';
import { infoSourcesApi } from '@/services/info-sources';
import type { InfoSource } from '@/services/info-sources';

export interface TopicDraft {
  name: string;
  description: string;
  cron: string;
  keywords: string;       // 逗号分隔字符串，提交时拆分
  sourceIds: string[];
  aiPrompt: string;
  enabled: boolean;
}

export interface TopicFormInitial {
  name: string;
  description: string;
  cron: string;
  keywords: string[];    // 编辑时从 string[] 还原
  sourceIds: string[];
  aiPrompt: string;
  enabled: boolean;
}

const EMPTY_DRAFT: TopicDraft = {
  name: '',
  description: '',
  cron: '',
  keywords: '',
  sourceIds: [],
  aiPrompt: '',
  enabled: true,
};

const inputClass = 'mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputStyle = {
  background: 'var(--paper-white)',
  color: 'var(--ink)',
  border: '1px solid var(--separator)',
};

export function DigestTopicForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: TopicFormInitial;
  onSubmit: (draft: TopicDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TopicDraft>(() =>
    initial
      ? {
          name: initial.name,
          description: initial.description,
          cron: initial.cron,
          keywords: initial.keywords.join(', '),
          sourceIds: initial.sourceIds,
          aiPrompt: initial.aiPrompt,
          enabled: initial.enabled,
        }
      : { ...EMPTY_DRAFT },
  );

  // 从 API 拉取真实信息源列表
  const [sources, setSources] = useState<InfoSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 加载信息源选项
    setSourcesLoading(true);
    infoSourcesApi
      .list()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        // 静默降级：选项为空，用户仍可填其他字段
        if (!cancelled) setSources([]);
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const availableSourceIds = sources.map((s) => s.id);

  const canSubmit = draft.name.trim().length > 0 && draft.cron.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>事项名称</FieldLabel>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="AI 应用发展"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <div>
        <FieldLabel>卷首语（可选）</FieldLabel>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="简单描述这个事项关注的方向…"
          rows={2}
          className={inputClass}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      <div>
        <FieldLabel>执行节奏（cron）</FieldLabel>
        <input
          type="text"
          value={draft.cron}
          onChange={(e) => setDraft((d) => ({ ...d, cron: e.target.value }))}
          placeholder="0 8 * * *"
          className={`${inputClass} font-mono`}
          style={inputStyle}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          五段式 cron，例：'0 8 * * *' 每天 8:00
        </p>
      </div>

      <div>
        <FieldLabel>关键词（逗号分隔）</FieldLabel>
        <textarea
          value={draft.keywords}
          onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))}
          placeholder="AI, LLM, 大模型, Agent, 应用落地"
          rows={2}
          className={inputClass}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      <div>
        <FieldLabel>订阅信息源</FieldLabel>
        {sourcesLoading ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            加载信息源…
          </p>
        ) : (
          <div className="mt-2">
            <ChipSelector<string>
              selected={draft.sourceIds}
              available={availableSourceIds}
              renderLabel={(id) => sources.find((s) => s.id === id)?.name ?? id}
              onAdd={(id) =>
                setDraft((d) => ({ ...d, sourceIds: [...d.sourceIds, id] }))
              }
              onRemove={(id) =>
                setDraft((d) => ({
                  ...d,
                  sourceIds: d.sourceIds.filter((x) => x !== id),
                }))
              }
              addLabel="选择信息源"
            />
            {sources.length === 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                暂无信息源，请先在「信息源」Tab 添加
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <FieldLabel>AI 判定 Prompt</FieldLabel>
        <textarea
          value={draft.aiPrompt}
          onChange={(e) => setDraft((d) => ({ ...d, aiPrompt: e.target.value }))}
          placeholder="描述这个事项关心什么、什么算相关。例：关注 AI 在实际产品中的落地应用案例，学术论文/纯技术文章不算。"
          rows={4}
          className={inputClass}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      <div className="flex items-center gap-3">
        <FieldLabel>启用</FieldLabel>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
          className="relative h-5 w-9 rounded-full transition-colors duration-150"
          style={{ background: draft.enabled ? 'var(--accent)' : 'var(--separator)' }}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150"
            style={{ left: draft.enabled ? '1.125rem' : '0.125rem' }}
          />
        </button>
      </div>

      <div className="flex gap-2 pt-2">
        <PrimaryButton onClick={() => canSubmit && onSubmit(draft)} disabled={!canSubmit}>
          {initial ? '保存' : '创建'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>取消</SecondaryButton>
      </div>
    </div>
  );
}
