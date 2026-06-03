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
import { skillsApi } from '@/services/skills';
import type { Skill } from '@/services/skills';
import { ChipSelector } from '@/components/shared/ChipSelector';
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

// ── 子组件：工具列表编辑器(ChipSelector 化) ──────────────────────

/**
 * ToolsEditor — 从可用工具池里 chip 多选。
 *
 * 演化:
 *  - #141(2026-05-30):自由 input → checkbox 列表(防拼错产毒数据)
 *  - Phase 3(2026-06-03):checkbox → ChipSelector(替代「捞」感,统一项目 chip 风格)
 *
 * 老数据残留(不在池中的工具,通常是被下线了):用 disabledReason 标注,
 * 仍可作为已选 chip 显示,× 可清理 — 不可在 popover 重新添加。
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
  // 池非空时检测孤儿(老数据存的工具已从池里下线);池空通常是 API 失败,不算真下线
  const orphanTools =
    availableTools.length > 0
      ? tools.filter((t) => !availableTools.includes(t))
      : [];

  // ChipSelector 的 available 必须包含 selected,否则 popover 会过滤;
  // 把 orphan 合并进 available 表面上"已下线"也能展示成 chip。
  const mergedAvailable = Array.from(
    new Set([...availableTools, ...orphanTools]),
  );

  return (
    <div
      className="space-y-2"
      style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : undefined }}
    >
      <ChipSelector
        selected={tools}
        available={mergedAvailable}
        onAdd={(t) => onChange([...tools, t])}
        onRemove={(t) => onChange(tools.filter((x) => x !== t))}
        renderMeta={(t) => (orphanTools.includes(t) ? '已下线' : undefined)}
      />
    </div>
  );
}

// ── 子组件:技能授权 section(spec §6.3) ────────────────────────

/**
 * SkillsSection — 给单个 agent 授权使用 skill 的 ChipSelector。
 *
 * 设计要点:
 *  - available = 全局 skills(传入),selected = agent.enabledSkillIds
 *  - groupBy 把 skill 分「可添加 / 不可添加」(看 skill.requiredTools 是否 ⊆ agent.tools)
 *  - disabledReason 列出缺哪些工具,在 popover 项上 tooltip 提示
 *  - chip 副标记列出该 skill 需要的工具,提醒用户依赖关系
 *  - 前端硬校验:加 skill 前看依赖是否齐(后端也会校验,这里是防御深度)
 */
function SkillsSection({
  selected,
  skills,
  agentTools,
  onChange,
  disabled,
}: {
  selected: string[];
  skills: Skill[];
  agentTools: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  if (skills.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
        还没有技能。可去「技能」tab 创建一个。
      </p>
    );
  }

  const skillsById = new Map(skills.map((s) => [s._id, s]));
  const availableIds = skills.map((s) => s._id);

  const missingTools = (skillId: string): string[] => {
    const skill = skillsById.get(skillId);
    if (!skill) return [];
    return skill.requiredTools.filter((t) => !agentTools.includes(t));
  };

  return (
    <div
      style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : undefined }}
    >
      <ChipSelector
        selected={selected}
        available={availableIds}
        renderLabel={(id) => skillsById.get(id)?.displayName ?? id}
        renderMeta={(id) => {
          const reqs = skillsById.get(id)?.requiredTools ?? [];
          return reqs.length > 0 ? `需 ${reqs.join(', ')}` : undefined;
        }}
        groupBy={(id) =>
          missingTools(id).length === 0 ? '可添加' : '不可添加'
        }
        disabledReason={(id) => {
          const miss = missingTools(id);
          return miss.length > 0 ? `缺工具: ${miss.join(', ')}` : undefined;
        }}
        onAdd={(id) => {
          // 前端硬校验:防止 disabledReason 被绕过(理论上 ChipSelector 已经挡)
          if (missingTools(id).length > 0) return;
          onChange([...selected, id]);
        }}
        onRemove={(id) => onChange(selected.filter((x) => x !== id))}
        addLabel="+ 授权技能"
      />
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
  skills,
  onSave,
  onDelete,
}: {
  agent: AgentConfig;
  providers: { id: string; name: string }[];
  availableTools: string[];
  /** 全局 skill 列表(spec §6.3),用来展示技能授权 chip + 校验 */
  skills: Skill[];
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
      flashProviderId: agent.flashProviderId,
      standardProviderId: agent.standardProviderId,
      thinkProviderId: agent.thinkProviderId,
      visionProviderId: agent.visionProviderId,
      enabledSkillIds: [...(agent.enabledSkillIds ?? [])],
    });
    setEditing(true);
  };

  // 启用守卫(#143 改造):当前 agent 默认 tier 对应的 slot 至少有一个有效 provider
  // (slot 自身 → providerId 全 tier 共用兜底 → 全局 activeAiProviderId 内核兜底)。
  // 这里只校验前两层(slot + 共用 providerId),因为前端不知 activeAiProviderId。
  const currentTier = draft.tier ?? agent.tier ?? 'standard';
  const tierProviderId =
    currentTier === 'flash'
      ? (draft.flashProviderId ?? agent.flashProviderId)
      : currentTier === 'think'
        ? (draft.thinkProviderId ?? agent.thinkProviderId)
        : currentTier === 'vision'
          ? (draft.visionProviderId ?? agent.visionProviderId)
          : (draft.standardProviderId ?? agent.standardProviderId);
  const fallbackProviderId = draft.providerId ?? agent.providerId;
  const effectiveProviderId = tierProviderId || fallbackProviderId;
  const providerValid =
    effectiveProviderId !== '' &&
    providers.some((p) => p.id === effectiveProviderId);
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

          {/* 模型绑定(#143 改造:4 个 tier 独立选 Provider,留空回退到通用 fallback) */}
          <div>
            <FieldLabel>
              模型绑定
              {!providerValid && (
                <span
                  className="ml-1.5 font-normal text-xs"
                  style={{ color: 'var(--mark-red)' }}
                >
                  默认 tier 至少要有一个 Provider 才能启用
                </span>
              )}
            </FieldLabel>
            {providers.length === 0 ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                还没有 Provider,请先到「集成」tab 添加。
              </p>
            ) : (
              <div className="mt-1 space-y-2">
                {/* 通用 fallback */}
                <div className="flex items-center gap-2">
                  <span
                    className="w-12 shrink-0 text-xs"
                    style={{ color: 'var(--ink-ghost)' }}
                  >
                    通用
                  </span>
                  <div className="flex-1">
                    <SelectInput
                      value={draft.providerId ?? agent.providerId ?? ''}
                      onChange={(v) =>
                        setDraft((d) => ({ ...d, providerId: v }))
                      }
                      options={[
                        { value: '', label: '— 不指定(用全局默认)—' },
                        ...providers.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      disabled={saving}
                    />
                  </div>
                </div>
                {/* 4 个 tier slot — 任意一个为空回退到上方"通用" */}
                {(
                  [
                    { key: 'flashProviderId', label: '快速' },
                    { key: 'standardProviderId', label: '标准' },
                    { key: 'thinkProviderId', label: '深思' },
                    { key: 'visionProviderId', label: '视觉' },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span
                      className="w-12 shrink-0 text-xs"
                      style={{ color: 'var(--ink-ghost)' }}
                    >
                      {label}
                    </span>
                    <div className="flex-1">
                      <SelectInput
                        value={
                          (draft[key] as string | undefined) ??
                          (agent[key] as string) ??
                          ''
                        }
                        onChange={(v) =>
                          setDraft((d) => ({ ...d, [key]: v }))
                        }
                        options={[
                          { value: '', label: '— 回退到「通用」—' },
                          ...providers.map((p) => ({
                            value: p.id,
                            label: p.name,
                          })),
                        ]}
                        disabled={saving}
                      />
                    </div>
                  </div>
                ))}
              </div>
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

          {/* 技能授权 — spec §6.3
            * available 分「可添加 / 不可添加」组,disabledReason 提示缺哪些工具。
            * 注意:把 enabledSkillIds 显式带进 draft 才会触发后端严格 validate 路径。 */}
          <div>
            <FieldLabel>
              授权使用的技能
              <span
                className="ml-1.5 font-normal text-xs"
                style={{ color: 'var(--ink-ghost)' }}
              >
                依赖工具齐备才能添加
              </span>
            </FieldLabel>
            <div className="mt-1.5">
              <SkillsSection
                selected={draft.enabledSkillIds ?? []}
                skills={skills}
                agentTools={draft.tools ?? []}
                onChange={(ids) =>
                  setDraft((d) => ({ ...d, enabledSkillIds: ids }))
                }
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
  // Phase 3:全局 skill 列表,给 SkillsSection 展示 chip + 校验依赖
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  // AI 自定义指令(system prompt)2026-05-31 从 IntegrationTab 挪到这里
  // —— system prompt 影响 agent 行为,归 agent 不归"集成"
  const [aiSystemPrompt, setAiSystemPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const promptDirty = aiSystemPrompt !== originalPrompt;

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [agentsRes, configRes, toolsRes, skillsRes] = await Promise.allSettled([
      settingsApi.getAgentConfigs(),
      settingsApi.getConfig(),
      settingsApi.getAvailableTools(),
      skillsApi.list(),
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
    // skill 列表拉失败不报错(技能 tab 是后引入的能力,不阻塞 agent 配置基本流);
    // 拉成功才覆盖 setSkills,失败保持原值(空 → SkillsSection 显示「还没有技能」提示)
    if (skillsRes.status === 'fulfilled') {
      setSkills(skillsRes.value);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  const handleSave = async (key: string, updated: Partial<AgentConfig>) => {
    try {
      const result = await settingsApi.saveAgentConfig(key, updated);
      // 后端 autoCleanupOrphanSkills 触发了 → 告诉用户哪些 skill 因工具变化被自动 disable
      // spec §6.3 + Task 0.7 链路:服务端返 cleaned 列表,UI 透出来
      if (result.cleaned && result.cleaned.length > 0) {
        const names = result.cleaned
          .map((c) => `「${c.skillName}」`)
          .join('、');
        banner.info(`工具变化导致 ${names} 自动取消授权`);
      } else {
        banner.success('Agent 配置已保存');
      }
      await loadData(true);
    } catch (err) {
      // 后端 400(skill 依赖校验失败等)→ 直接展示 message
      const msg = err instanceof Error ? err.message : '保存失败,请重试';
      banner.error(msg);
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
                skills={skills}
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
