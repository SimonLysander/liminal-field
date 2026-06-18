/**
 * DigestTopicForm — 事项新建/编辑表单
 * 从 digest/TopicForm.tsx 迁移到 settings 目录，配合 DigestTab settings sub-tab 使用。
 */

import { useState } from 'react';
import { ChipSelector } from '@/components/shared/ChipSelector';
import { FieldLabel, PrimaryButton, SecondaryButton } from './SettingsUI';

// ── 共享 mock 数据（和主页保持一致，避免 API 依赖） ──────────────────────────

export const MOCK_SOURCES_OPTIONS = [
  { id: 'src_1a2b3c4d5e6f', label: 'Paul Graham Essays' },
  { id: 'src_7g8h9i0j1k2l', label: 'Hacker News Frontpage' },
  { id: 'src_3m4n5o6p7q8r', label: 'LessWrong' },
  { id: 'src_9s0t1u2v3w4x', label: '少数派' },
  { id: 'src_5y6z7a8b9c0d', label: '阮一峰的网络日志' },
] as const;

export type SourceId = typeof MOCK_SOURCES_OPTIONS[number]['id'];

export interface TopicDraft {
  name: string;
  cron: string;
  keywords: string;
  sourceIds: SourceId[];
  aiPrompt: string;
  enabled: boolean;
}

export interface TopicFormInitial {
  name: string;
  cron: string;
  enabled: boolean;
}

const EMPTY_DRAFT: TopicDraft = {
  name: '',
  cron: '',
  keywords: '',
  sourceIds: [],
  aiPrompt: '',
  enabled: true,
};

const ALL_SOURCE_IDS = MOCK_SOURCES_OPTIONS.map((s) => s.id);

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
      ? { name: initial.name, cron: initial.cron, keywords: '', sourceIds: [], aiPrompt: '', enabled: initial.enabled }
      : { ...EMPTY_DRAFT },
  );

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
        <div className="mt-2">
          <ChipSelector<SourceId>
            selected={draft.sourceIds}
            available={ALL_SOURCE_IDS}
            renderLabel={(id) => MOCK_SOURCES_OPTIONS.find((s) => s.id === id)?.label ?? id}
            onAdd={(id) => setDraft((d) => ({ ...d, sourceIds: [...d.sourceIds, id] }))}
            onRemove={(id) => setDraft((d) => ({ ...d, sourceIds: d.sourceIds.filter((x) => x !== id) }))}
            addLabel="选择信息源"
          />
        </div>
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
