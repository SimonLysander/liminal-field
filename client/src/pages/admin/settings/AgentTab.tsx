/*
 * AgentTab — Agent 配置 tab
 *
 * 管理系统中所有 agent 入口的配置项，包括：
 * - 启用/禁用开关
 * - 一句话描述
 * - 自定义 system prompt（覆盖默认角色定义）
 * - 工具列表（可编辑 tag）
 * - 默认模型层级（flash / standard / think）
 *
 * 数据存在 system_config 单例的 agentConfigs 数组中，以 key 区分入口。
 * 组件自包含：内部独立 fetch，不依赖父组件传入数据。
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { AgentConfig } from '@/services/settings';
import {
  PageHeader,
  Section,
  SectionSkeleton,
  FieldLabel,
  TextInput,
  SelectInput,
  PrimaryButton,
  SecondaryButton,
} from './SettingsUI';

// ── 常量 ─────────────────────────────────────────────────────────

/** 可选的模型层级 */
const TIER_OPTIONS = [
  { value: 'flash', label: '闪电（快速、低成本）' },
  { value: 'standard', label: '标准（日常默认）' },
  { value: 'think', label: '深思（复杂推理）' },
] as const;

/**
 * 常用工具预设列表，供用户点击快速添加。
 * 实际可用工具以 agent 服务注册的为准，此处仅辅助录入。
 */
const TOOL_PRESETS = [
  'search_knowledge_base',
  'read_document_content',
  'get_current_draft',
  'remember',
  'forget',
  'sub_agent',
  'create_task',
  'update_task',
];

// ── 子组件：工具列表编辑器 ────────────────────────────────────────

/**
 * ToolsEditor — 工具名 tag 列表编辑器。
 *
 * 支持：点击预设快速添加、手动输入（Enter 确认）、点击 tag 删除。
 */
function ToolsEditor({
  tools,
  onChange,
  disabled,
}: {
  tools: string[];
  onChange: (tools: string[]) => void;
  disabled: boolean;
}) {
  const [inputValue, setInputValue] = useState('');

  // 添加工具（去重）
  const addTool = (toolName: string) => {
    const trimmed = toolName.trim();
    if (!trimmed || tools.includes(trimmed)) return;
    onChange([...tools, trimmed]);
    setInputValue('');
  };

  // 删除工具
  const removeTool = (toolName: string) => {
    onChange(tools.filter((t) => t !== toolName));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTool(inputValue);
    }
  };

  return (
    <div className="space-y-2">
      {/* 已添加工具 tag 列表 */}
      <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
        {tools.length === 0 && (
          <span className="text-xs py-1" style={{ color: 'var(--ink-ghost)' }}>
            暂无工具
          </span>
        )}
        {tools.map((tool) => (
          <span
            key={tool}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono"
            style={{
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              color: 'var(--ink-faded)',
              border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
            }}
          >
            {tool}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTool(tool)}
                className="rounded transition-opacity hover:opacity-60"
                style={{ color: 'var(--ink-ghost)' }}
                title={`移除 ${tool}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
      </div>

      {/* 预设工具快速添加 */}
      <div className="flex flex-wrap gap-1">
        {TOOL_PRESETS.filter((t) => !tools.includes(t)).map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={disabled}
            onClick={() => addTool(preset)}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-mono transition-opacity disabled:opacity-40"
            style={{
              color: 'var(--ink-ghost)',
              border: '1px dashed var(--separator)',
            }}
            title={`添加 ${preset}`}
          >
            <Plus size={10} />
            {preset}
          </button>
        ))}
      </div>

      {/* 手动输入 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入工具名，按 Enter 添加"
          disabled={disabled}
          className="h-8 flex-1 rounded-lg px-3 text-xs outline-none disabled:opacity-50"
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
          }}
        />
        <button
          type="button"
          disabled={disabled || !inputValue.trim()}
          onClick={() => addTool(inputValue)}
          className="h-8 rounded-lg px-3 text-xs font-medium transition-opacity disabled:opacity-40"
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink-faded)',
            border: '1px solid var(--separator)',
          }}
        >
          添加
        </button>
      </div>
    </div>
  );
}

// ── 子组件：单个 Agent 入口卡片 ───────────────────────────────────

/**
 * AgentCard — 单个 agent 入口的展示 + 编辑卡片。
 *
 * 卡片顶部常驻显示名称和启用开关，其余字段折叠在展开区域。
 * 只有点击"编辑"后进入编辑态，避免误操作。
 */
function AgentCard({
  agent,
  onSave,
  onDelete,
}: {
  agent: AgentConfig;
  onSave: (updated: Partial<AgentConfig>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 编辑态本地草稿
  const [draft, setDraft] = useState<Partial<AgentConfig>>({});

  // 进入编辑：用当前值初始化草稿
  const startEdit = () => {
    setDraft({
      name: agent.name,
      description: agent.description,
      enabled: agent.enabled,
      systemPrompt: agent.systemPrompt,
      tools: [...agent.tools],
      tier: agent.tier,
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft({});
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      setDraft({});
    } catch {
      // 错误由父层通过 banner 提示，此处只重置状态
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = onDelete
    ? async () => {
        setDeleting(true);
        try {
          await onDelete();
        } catch {
          // 同上
        } finally {
          setDeleting(false);
        }
      }
    : undefined;

  // 展示模式下当前 tier 的显示标签
  const tierLabel = TIER_OPTIONS.find((t) => t.value === agent.tier)?.label ?? agent.tier;

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{
        background: 'var(--paper-dark)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {/* ── 顶行：名称 + 启用开关 + 操作按钮 ── */}
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {agent.name}
        </span>

        {/* 启用状态指示点（只读模式展示） */}
        {!editing && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: agent.enabled ? 'var(--mark-green)' : 'var(--separator)' }}
            title={agent.enabled ? '已启用' : '已禁用'}
          />
        )}

        {/* 编辑 / 删除按钮 */}
        {!editing && (
          <>
            <button
              type="button"
              onClick={startEdit}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100"
              style={{ color: 'var(--ink-faded)', background: 'var(--shelf)' }}
            >
              编辑
            </button>
            {handleDelete && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="rounded p-1 transition-opacity duration-100 disabled:opacity-40"
                style={{ color: 'var(--ink-ghost)' }}
                title="删除此 agent 配置"
              >
                <Trash2 size={14} />
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 只读展示区域 ── */}
      {!editing && (
        <div className="space-y-2">
          {agent.description && (
            <p className="text-xs" style={{ color: 'var(--ink-faded)' }}>
              {agent.description}
            </p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              层级：<span style={{ color: 'var(--ink-faded)' }}>{tierLabel}</span>
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              工具：<span style={{ color: 'var(--ink-faded)' }}>{agent.tools.length} 个</span>
            </span>
            {agent.systemPrompt && (
              <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
                自定义指令：<span style={{ color: 'var(--ink-faded)' }}>已配置</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── 编辑表单区域 ── */}
      {editing && (
        <div className="space-y-4">
          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <FieldLabel>启用</FieldLabel>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled ?? agent.enabled}
              onClick={() => setDraft((d) => ({ ...d, enabled: !(d.enabled ?? agent.enabled) }))}
              disabled={saving}
              className="relative h-5 w-9 rounded-full transition-colors duration-200 disabled:opacity-40"
              style={{
                background: (draft.enabled ?? agent.enabled)
                  ? 'var(--mark-green)'
                  : 'var(--separator)',
              }}
            >
              <span
                className="absolute top-0.5 h-4 w-4 rounded-full shadow transition-transform duration-200"
                style={{
                  background: 'white',
                  transform: (draft.enabled ?? agent.enabled) ? 'translateX(1.25rem)' : 'translateX(0.125rem)',
                }}
              />
            </button>
          </div>

          {/* 显示名称 */}
          <div>
            <FieldLabel>名称</FieldLabel>
            <TextInput
              value={draft.name ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="写作顾问"
              disabled={saving}
            />
          </div>

          {/* 描述 */}
          <div>
            <FieldLabel>描述</FieldLabel>
            <TextInput
              value={draft.description ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
              placeholder="一句话说明此 agent 的用途"
              disabled={saving}
            />
          </div>

          {/* 默认层级 */}
          <div>
            <FieldLabel>默认模型层级</FieldLabel>
            <SelectInput
              value={draft.tier ?? 'standard'}
              onChange={(v) => setDraft((d) => ({ ...d, tier: v }))}
              options={TIER_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
              disabled={saving}
            />
          </div>

          {/* 工具列表 */}
          <div>
            <FieldLabel>启用的工具</FieldLabel>
            <div className="mt-1.5">
              <ToolsEditor
                tools={draft.tools ?? []}
                onChange={(tools) => setDraft((d) => ({ ...d, tools }))}
                disabled={saving}
              />
            </div>
          </div>

          {/* 自定义 system prompt */}
          <div>
            <FieldLabel>
              自定义指令
              <span className="ml-1.5 font-normal text-xs" style={{ color: 'var(--ink-ghost)' }}>
                留空则使用默认 system prompt
              </span>
            </FieldLabel>
            <textarea
              value={draft.systemPrompt ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              placeholder="例如：你是专业的技术写作顾问，专注于帮助工程师写清晰的文档..."
              rows={5}
              disabled={saving}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
              style={{
                background: 'var(--shelf)',
                color: 'var(--ink)',
                border: '1px solid var(--separator)',
                resize: 'vertical',
              }}
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2">
            <PrimaryButton onClick={() => void handleSave()} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </PrimaryButton>
            <SecondaryButton onClick={cancelEdit} disabled={saving}>
              取消
            </SecondaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
// 新增 agent 入口需要开发（工具、prompt、前端集成），不在 Settings 里创建。

/**
 * AgentTab — 自包含，内部独立 loadData。
 * 静默刷新（silent=true）避免操作后页面闪屏。
 */
export function AgentTab() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  // 加载数据：silent=true 时跳过 setLoading(true)，避免页面闪烁
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await settingsApi.getAgentConfigs();
      setAgents(data);
    } catch {
      banner.error('加载 Agent 配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  // 保存某个 agent 配置
  const handleSave = async (key: string, updated: Partial<AgentConfig>) => {
    try {
      await settingsApi.saveAgentConfig(key, updated);
      banner.success('Agent 配置已保存');
      await loadData(true);
    } catch {
      banner.error('保存失败，请重试');
      throw new Error('save failed'); // 让 AgentCard 知道出错
    }
  };

  // 内置 agent 不允许删除，只能编辑配置

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader>Agent 配置</PageHeader>
        <SectionSkeleton title="Agent 入口" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader>Agent 配置</PageHeader>

      {/* ── Agent 入口列表 ── */}
      <Section
        title="Agent 入口"
        description="每个入口对应一个对话场景，独立配置工具集、指令和模型层级"
      >
        {/* 卡片列表 */}
        {agents.length > 0 ? (
          <div className="space-y-3 mb-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.key}
                agent={agent}
                onSave={(updated) => handleSave(agent.key, updated)}
                onDelete={undefined}
              />
            ))}
          </div>
        ) : (
          <div
            className="mb-4 rounded-lg px-4 py-6 text-center text-sm"
            style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
          >
            暂无内置 Agent 入口
          </div>
        )}
      </Section>
    </div>
  );
}
