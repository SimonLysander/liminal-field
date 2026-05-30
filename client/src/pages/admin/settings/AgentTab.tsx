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
import { Trash2 } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/services/settings';
import type { AgentConfig } from '@/services/settings';
// AgentCard 内部仍用 SettingsUI 原子,下一轮 #145 收编时统一
import {
  FieldLabel,
  TextInput,
  SelectInput,
  PrimaryButton,
  SecondaryButton,
  Toggle,
} from './SettingsUI';
import { MemoriesSection } from './MemoriesSection';

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
// ── 子组件：工具列表编辑器(checkbox 池子勾选) ──────────────────────

/**
 * ToolsEditor — 从可用工具池(availableTools)勾选 checkbox。
 *
 * #141 重构(2026-05-30):此前是自由 input + 添加按钮,允许用户输入任意字符串
 * (拼错会成毒数据,agent 启动时静默忽略)。改成 checkbox 列表,工具池由后端
 * GET /settings/agent-configs/available-tools 提供。老数据若有不在池中的
 * 工具(已下线)→ 显示为红字"已下线"+ 移除按钮供清理。
 */
function ToolsEditor({
  tools,
  availableTools,
  onChange,
  disabled,
}: {
  tools: string[];
  availableTools: string[];
  onChange: (tools: string[]) => void;
  disabled: boolean;
}) {
  const toggle = (tool: string) => {
    if (tools.includes(tool)) {
      onChange(tools.filter((t) => t !== tool));
    } else {
      onChange([...tools, tool]);
    }
  };
  const orphanTools = tools.filter((t) => !availableTools.includes(t));

  return (
    <div className="space-y-1.5">
      {/* 池中工具 checkbox */}
      {availableTools.map((tool) => {
        const checked = tools.includes(tool);
        return (
          <label
            key={tool}
            className="flex items-center gap-2 cursor-pointer"
            style={{ opacity: disabled ? 0.5 : 1 }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(tool)}
              className="h-3.5 w-3.5 cursor-pointer accent-current"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span
              className="text-xs font-mono"
              style={{ color: checked ? 'var(--ink)' : 'var(--ink-faded)' }}
            >
              {tool}
            </span>
          </label>
        );
      })}

      {/* 老数据残留:不在池中的工具(已下线,标红供清理) */}
      {orphanTools.length > 0 && (
        <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
          {orphanTools.map((tool) => (
            <div
              key={tool}
              className="flex items-center gap-2 text-xs font-mono py-0.5"
              style={{ color: 'var(--mark-red)' }}
            >
              <span>⚠ {tool}(已下线,建议移除)</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(tool)}
                  className="text-xs underline opacity-80 hover:opacity-100"
                  style={{ color: 'var(--mark-red)' }}
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
      )}
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
  providers,
  availableTools,
  onSave,
  onDelete,
}: {
  agent: AgentConfig;
  providers: { id: string; name: string }[];
  availableTools: string[];
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
      providerId: agent.providerId,
    });
    setEditing(true);
  };

  // #5 重构守卫:必须选了有效 provider 才能启用 agent。
  // 当前 draft 的 providerId 未选 / 不在 providers 列表中 → 启用开关 disabled。
  const currentProviderId = draft.providerId ?? agent.providerId;
  const providerValid =
    currentProviderId !== '' && providers.some((p) => p.id === currentProviderId);
  const enableSwitchDisabled = saving || !providerValid;

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
      className="rounded-lg p-5 space-y-4"
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
          {/* 启用开关:必须先选 provider 才能启用(#5 重构守卫);复用 SettingsUI.Toggle */}
          <div
            className="flex items-center justify-between"
            title={!providerValid ? '先选 Provider 才能启用' : undefined}
          >
            <FieldLabel>启用</FieldLabel>
            <Toggle
              checked={(draft.enabled ?? agent.enabled) && providerValid}
              onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
              disabled={enableSwitchDisabled}
            />
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

          {/* Provider 选择(#5 重构:每个 agent 自选,启用前必填) */}
          <div>
            <FieldLabel>
              Provider
              {!providerValid && (
                <span className="ml-1.5 font-normal text-xs" style={{ color: 'var(--mark-red)' }}>
                  必选,未选时启用被禁用
                </span>
              )}
            </FieldLabel>
            {providers.length === 0 ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                还没有 Provider,请先到「集成」tab 添加。
              </p>
            ) : (
              <SelectInput
                value={draft.providerId ?? agent.providerId ?? ''}
                onChange={(v) => setDraft((d) => ({ ...d, providerId: v }))}
                options={[
                  { value: '', label: '— 未选 —' },
                  ...providers.map((p) => ({ value: p.id, label: p.name })),
                ]}
                disabled={saving}
              />
            )}
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
                availableTools={availableTools}
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
                background: 'var(--paper-white)',
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
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // AI 自定义指令(system prompt)2026-05-31 从 IntegrationTab 挪到这里
  // —— system prompt 影响 agent 行为,归 agent 不归"集成"
  const [aiSystemPrompt, setAiSystemPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const promptDirty = aiSystemPrompt !== originalPrompt;

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [agentsRes, configRes, toolsRes] = await Promise.allSettled([
      settingsApi.getAgentConfigs(),
      settingsApi.getConfig(),
      settingsApi.getAvailableTools(),
    ]);
    if (agentsRes.status === 'fulfilled') {
      setAgents(agentsRes.value);
    } else {
      banner.error('加载 Agent 配置失败');
    }
    if (configRes.status === 'fulfilled') {
      setProviders(
        configRes.value.ai.providers.map((p) => ({ id: p.id, name: p.name })),
      );
      setAiSystemPrompt(configRes.value.ai.aiSystemPrompt ?? '');
      setOriginalPrompt(configRes.value.ai.aiSystemPrompt ?? '');
    }
    if (toolsRes.status === 'fulfilled') {
      setAvailableTools(toolsRes.value);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  const handleSave = async (key: string, updated: Partial<AgentConfig>) => {
    try {
      await settingsApi.saveAgentConfig(key, updated);
      banner.success('Agent 配置已保存');
      await loadData(true);
    } catch {
      banner.error('保存失败,请重试');
      throw new Error('save failed');
    }
  };

  const handleSavePrompt = async () => {
    if (!promptDirty || savingPrompt) return;
    setSavingPrompt(true);
    try {
      await settingsApi.saveAiSystemPrompt(aiSystemPrompt);
      setOriginalPrompt(aiSystemPrompt);
      banner.success('自定义指令已保存');
    } catch {
      banner.error('保存失败');
    } finally {
      setSavingPrompt(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          Agent
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          自定义对话风格、入口工具集与对你的认知
        </p>
      </div>
      <Separator />

      {/* ── 全局自定义指令(system prompt) ── */}
      <section className="space-y-4">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            全局自定义指令
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            追加到所有 agent 默认角色定义之后,影响所有对话
          </p>
        </div>
        {loading ? (
          <div
            className="h-20 rounded-sm animate-pulse"
            style={{ background: 'var(--shelf)' }}
          />
        ) : (
          <>
            <textarea
              value={aiSystemPrompt}
              onChange={(e) => setAiSystemPrompt(e.target.value)}
              placeholder="例如:我是一名软件工程师,主要写技术笔记,请用中文回复。"
              rows={5}
              className="flex w-full resize-none rounded-sm border border-transparent bg-[var(--shelf)] px-2.5 py-1.5 text-md transition-colors placeholder:text-[var(--ink-ghost)] hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSavePrompt()}
                disabled={!promptDirty || savingPrompt}
              >
                {savingPrompt ? '保存中…' : '保存'}
              </Button>
              {promptDirty && !savingPrompt && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAiSystemPrompt(originalPrompt)}
                >
                  放弃修改
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <Separator />

      {/* ── Agent 入口列表 ── */}
      <section className="space-y-4">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            Agent 入口
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            每个入口对应一个对话场景,独立配置 provider、工具集、指令和模型层级
          </p>
        </div>
        {loading ? (
          <div
            className="h-24 rounded-sm animate-pulse"
            style={{ background: 'var(--shelf)' }}
          />
        ) : agents.length > 0 ? (
          <div className="space-y-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.key}
                agent={agent}
                providers={providers}
                availableTools={availableTools}
                onSave={(updated) => handleSave(agent.key, updated)}
                onDelete={undefined}
              />
            ))}
          </div>
        ) : (
          <div
            className="rounded-sm px-3 py-4 text-center text-xs"
            style={{
              color: 'var(--ink-ghost)',
              border: '1px dashed var(--separator)',
            }}
          >
            暂无内置 Agent 入口
          </div>
        )}
      </section>

      <Separator />

      {/* ── Agent 对你 / 你项目的认知 ── */}
      <MemoriesSection />
    </div>
  );
}
