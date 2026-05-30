/*
 * IntegrationTab — 集成 tab
 *
 * MinerU Token 配置 + 多提供商 AI 配置（添加 / 删除 / 切换 / 编辑 tier 绑定 / 验证）。
 *
 * AI 配置设计：
 * - 每个"提供商"绑定三个 tier 的模型（flash / standard / think）
 * - 点击某行 → 切换为 active（激活后 AI 功能使用该提供商）
 * - 添加时先调 validate 验证 standard 模型连通性，通过再保存
 * - baseUrl 由 AI_PROVIDERS preset 决定，不由用户手动输入
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, Plus, Pencil } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { SettingsConfigView } from '@/services/settings';
import {
  PageHeader,
  EditableSection,
  Section,
  SectionSkeleton,
  FieldLabel,
  TextInput,
  SelectInput,
  StatusRow,
  ValidationBanner,
  PrimaryButton,
  SecondaryButton,
} from './SettingsUI';

// ── AI 提供商预设（只含 id 和名称，模型列表从 API 实时获取） ──────
const AI_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'zhipu', name: '智谱 GLM' },
  { id: 'moonshot', name: 'Moonshot' },
] as const;

type ProviderId = (typeof AI_PROVIDERS)[number]['id'];

// ── tier 标签配置 ─────────────────────────────────────────────────
const TIERS = [
  { key: 'flashModel', label: '闪电', description: '快速、低成本，适合简单问答' },
  { key: 'standardModel', label: '标准', description: '日常写作顾问，默认使用' },
  { key: 'thinkModel', label: '深思', description: '复杂分析与推理' },
] as const;

type TierKey = (typeof TIERS)[number]['key'];

// ── 类型 ──────────────────────────────────────────────────────────

// （已移除 IntegrationTabProps：组件自包含，不接受父组件数据）

// ── 子组件：tier 选择区 ───────────────────────────────────────────

function TierModelSelects({
  availableModels,
  loadingModels,
  tierValues,
  onTierChange,
  disabled,
}: {
  availableModels: string[];
  loadingModels: boolean;
  tierValues: Record<TierKey, string>;
  onTierChange: (key: TierKey, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      {TIERS.map(({ key, label, description }) => (
        <div key={key}>
          <FieldLabel>
            {label} 模型
            <span className="ml-1.5 font-normal text-xs" style={{ color: 'var(--ink-ghost)' }}>
              {description}
            </span>
          </FieldLabel>
          {availableModels.length > 0 ? (
            <SelectInput
              value={tierValues[key]}
              onChange={(v) => onTierChange(key, v)}
              options={availableModels.map((m) => ({ value: m, label: m }))}
              disabled={disabled || loadingModels}
            />
          ) : (
            <p className="text-xs py-1" style={{ color: 'var(--ink-ghost)' }}>
              {loadingModels ? '加载中...' : '请先输入 API Key 以获取模型列表'}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 子组件：视觉模型字段(可选、自由输入,与三档并排在同一区) ──────────
function VisionModelField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <FieldLabel>
        视觉 模型
        <span className="ml-1.5 font-normal text-xs" style={{ color: 'var(--ink-ghost)' }}>
          可选 · 画廊看图写图说;留空则画廊无 AI
        </span>
      </FieldLabel>
      <TextInput
        value={value}
        onChange={onChange}
        placeholder="如 qwen-vl-max / glm-4v;无则留空"
        disabled={disabled}
      />
    </div>
  );
}

// ── 子组件：模型行 ────────────────────────────────────────────────

function ProviderRow({
  provider,
  onDelete,
  onEdit,
  deleting,
}: {
  provider: SettingsConfigView['ai']['providers'][number];
  onDelete: () => void;
  onEdit: () => void;
  deleting: boolean;
}) {
  const providerLabel = AI_PROVIDERS.find((p) => p.id === provider.provider)?.name ?? provider.provider;
  // #5 重构(2026-05-30):去掉"激活某一个 provider"的概念。配过的都视为可用,
  // 由各 agent 在 AgentTab 自选使用哪一个。所以这里不再有 isActive/onActivate,
  // 行也不再 cursor-pointer。
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--paper-white)',
        border: '1px solid var(--separator)',
      }}
    >
      {/* 顶行：提供商名 + 操作按钮 */}
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 text-sm font-medium" style={{ color: 'var(--ink)' }}>
          {providerLabel}
        </span>

        {/* 编辑按钮 */}
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 transition-opacity duration-100"
          style={{ color: 'var(--ink-ghost)' }}
          title="编辑 tier 绑定"
        >
          <Pencil size={13} />
        </button>

        {/* 删除按钮 */}
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="rounded p-1 transition-opacity duration-100 disabled:opacity-40"
          style={{ color: 'var(--ink-ghost)' }}
          title="删除此提供商"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 三 tier 模型名展示 + 视觉模型(总是显示,无配则灰字"未配置"——让用户知道有此字段) */}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-5">
        {TIERS.map(({ key, label }) => (
          <span key={key} className="text-xs" style={{ color: 'var(--ink-faded)' }}>
            <span style={{ color: 'var(--ink-ghost)' }}>{label}：</span>
            {provider[key as keyof typeof provider] as string}
          </span>
        ))}
        <span className="text-xs" style={{ color: provider.visionModel ? 'var(--ink-faded)' : 'var(--ink-ghost)' }}>
          <span style={{ color: 'var(--ink-ghost)' }}>视觉：</span>
          {provider.visionModel || '未配置'}
        </span>
      </div>
    </div>
  );
}

// ── 子组件：编辑提供商 tier 绑定表单 ────────────────────────────────

function EditProviderForm({
  provider,
  onSuccess,
  onCancel,
}: {
  provider: SettingsConfigView['ai']['providers'][number];
  onSuccess: () => Promise<void>;
  onCancel: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [tierValues, setTierValues] = useState<Record<TierKey, string>>({
    flashModel: provider.flashModel,
    standardModel: provider.standardModel,
    thinkModel: provider.thinkModel,
  });
  // 视觉模型:可选、独立 state(不进必填三档),自由输入——视觉模型常不在 /models 列表里
  const [visionModel, setVisionModel] = useState(provider.visionModel ?? '');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);

  // 输入新 API Key 时拉取模型列表
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleApiKeyChange = useCallback((v: string) => {
    setApiKey(v);
    clearTimeout(debounceRef.current);
    if (!v.trim()) { setAvailableModels([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingModels(true);
      try {
        const { models } = await settingsApi.listProviderModels({
          provider: provider.provider,
          apiKey: v.trim(),
        });
        setAvailableModels(models);
      } catch {
        setAvailableModels([]);
      } finally {
        setLoadingModels(false);
      }
    }, 600);
  }, [provider.provider]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Parameters<typeof settingsApi.updateAiProvider>[1] = {
        flashModel: tierValues.flashModel,
        standardModel: tierValues.standardModel,
        thinkModel: tierValues.thinkModel,
        visionModel: visionModel.trim(),
      };
      if (apiKey.trim()) updates.apiKey = apiKey.trim();
      await settingsApi.updateAiProvider(provider.id, updates);
      banner.success('提供商配置已更新');
      await onSuccess();
    } catch {
      banner.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="space-y-4 rounded-lg p-4"
      style={{ background: 'var(--shelf)', border: '1px solid var(--separator)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-faded)' }}>
        编辑 {AI_PROVIDERS.find((p) => p.id === provider.provider)?.name ?? provider.provider} tier 绑定
      </p>

      {/* 可选：更新 API Key */}
      <div>
        <FieldLabel>
          API Key
          <span className="ml-2 font-normal" style={{ color: 'var(--ink-ghost)' }}>
            已配置，留空则不修改；填写后会同步拉取模型列表
          </span>
        </FieldLabel>
        <TextInput
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="sk-..."
          type="password"
          disabled={saving}
        />
      </div>

      {/* Tier 模型选择 */}
      <TierModelSelects
        availableModels={availableModels}
        loadingModels={loadingModels}
        tierValues={tierValues}
        onTierChange={(key, value) => setTierValues((prev) => ({ ...prev, [key]: value }))}
        disabled={saving}
      />

      {/* 当模型列表未加载时，允许手动输入已知模型名 */}
      {availableModels.length === 0 && !loadingModels && (
        <div className="space-y-3">
          {TIERS.map(({ key, label }) => (
            <div key={key}>
              <FieldLabel>{label} 模型名</FieldLabel>
              <TextInput
                value={tierValues[key]}
                onChange={(v) => setTierValues((prev) => ({ ...prev, [key]: v }))}
                placeholder="输入模型 ID，例如 deepseek-chat"
                disabled={saving}
              />
            </div>
          ))}
        </div>
      )}

      {/* 视觉模型(可选):跟三档并排在同一区,但自由输入、不必填 */}
      <VisionModelField value={visionModel} onChange={setVisionModel} disabled={saving} />

      <div className="flex gap-2">
        <PrimaryButton onClick={() => void handleSave()} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>
          取消
        </SecondaryButton>
      </div>
    </div>
  );
}

// ── 子组件：添加提供商表单 ────────────────────────────────────────

function AddProviderForm({ onSuccess, onCancel }: {
  onSuccess: () => Promise<void>;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<ProviderId>(AI_PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState('');
  const [tierValues, setTierValues] = useState<Record<TierKey, string>>({
    flashModel: '',
    standardModel: '',
    thinkModel: '',
  });
  // 视觉模型:可选、自由输入,不参与三档必填校验
  const [visionModel, setVisionModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [validateResult, setValidateResult] = useState<{ valid: boolean; message: string } | null>(null);

  // 模型列表：从提供商 API 动态获取
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // 拉取模型列表：provider + apiKey 都有值时触发
  const fetchModels = useCallback(async (prov: string, key: string) => {
    if (!key.trim()) {
      setAvailableModels([]);
      setTierValues({ flashModel: '', standardModel: '', thinkModel: '' });
      return;
    }
    setLoadingModels(true);
    try {
      const { models } = await settingsApi.listProviderModels({ provider: prov, apiKey: key.trim() });
      setAvailableModels(models);
      // 自动预填第一个模型到所有 tier（用户可再手动调整）
      const first = models[0] ?? '';
      setTierValues({ flashModel: first, standardModel: first, thinkModel: first });
    } catch {
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // 切换提供商时重置状态
  const handleProviderChange = useCallback((id: string) => {
    setProvider(id as ProviderId);
    setValidateResult(null);
    setAvailableModels([]);
    setTierValues({ flashModel: '', standardModel: '', thinkModel: '' });
    setVisionModel('');
    if (apiKey.trim()) void fetchModels(id, apiKey);
  }, [apiKey, fetchModels]);

  // API Key 输入防抖拉取模型列表
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleApiKeyChange = useCallback((v: string) => {
    setApiKey(v);
    setValidateResult(null);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchModels(provider, v), 600);
  }, [provider, fetchModels]);

  // 校验三个 tier 都已选择
  const allTiersFilled = tierValues.flashModel && tierValues.standardModel && tierValues.thinkModel;

  const handleValidateAndSave = async () => {
    if (!apiKey.trim()) {
      banner.error('请输入 API Key');
      return;
    }
    if (!allTiersFilled) {
      banner.error('请为三个 tier 各选择一个模型');
      return;
    }
    setSaving(true);
    setValidateResult(null);
    try {
      // 用 standard 模型做连通性验证
      const result = await settingsApi.validateAiProvider({
        provider,
        apiKey: apiKey.trim(),
        standardModel: tierValues.standardModel,
      });
      setValidateResult(result);
      if (!result.valid) {
        setSaving(false);
        return;
      }
      await settingsApi.addAiProvider({
        provider,
        apiKey: apiKey.trim(),
        flashModel: tierValues.flashModel,
        standardModel: tierValues.standardModel,
        thinkModel: tierValues.thinkModel,
        visionModel: visionModel.trim() || undefined,
      });
      banner.success('AI 提供商已添加');
      await onSuccess();
    } catch {
      banner.error('操作失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="space-y-4 rounded-lg p-4"
      style={{ background: 'var(--shelf)', border: '1px solid var(--separator)' }}
    >
      {/* 提供商选择 */}
      <div>
        <FieldLabel>提供商</FieldLabel>
        <SelectInput
          value={provider}
          onChange={handleProviderChange}
          options={AI_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
          disabled={saving}
        />
      </div>

      {/* API Key 输入 */}
      <div>
        <FieldLabel>API Key</FieldLabel>
        <TextInput
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="sk-..."
          type="password"
          disabled={saving}
        />
      </div>

      {/* 三 tier 模型绑定 */}
      {availableModels.length > 0 ? (
        <TierModelSelects
          availableModels={availableModels}
          loadingModels={loadingModels}
          tierValues={tierValues}
          onTierChange={(key, value) => {
            setTierValues((prev) => ({ ...prev, [key]: value }));
            setValidateResult(null);
          }}
          disabled={saving}
        />
      ) : (
        <div>
          <p className="text-xs py-1" style={{ color: 'var(--ink-ghost)' }}>
            {loadingModels
              ? '加载模型列表中...'
              : apiKey.trim()
              ? '未获取到模型列表，请检查 API Key'
              : '请先输入 API Key，自动拉取可用模型'}
          </p>
        </div>
      )}

      {/* 视觉模型(可选):跟三档并排在同一区,但自由输入、不必填 */}
      <VisionModelField value={visionModel} onChange={setVisionModel} disabled={saving} />

      {/* 验证结果 */}
      {validateResult && <ValidationBanner result={validateResult} />}

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <PrimaryButton
          onClick={() => void handleValidateAndSave()}
          disabled={saving || !allTiersFilled}
        >
          {saving ? '验证中...' : '验证并保存'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>
          取消
        </SecondaryButton>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
// 自包含：组件内部独立 loadData，不依赖父组件传入数据或回调。
// silent=true 时跳过 setLoading(true)，避免操作后页面闪屏。

export function IntegrationTab() {
  // ─── 内部数据状态 ───

  const [config, setConfig] = useState<SettingsConfigView['integration'] | null>(null);
  const [aiConfig, setAiConfig] = useState<SettingsConfigView['ai'] | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const c = await settingsApi.getConfig().catch(() => null);
    setConfig(c?.integration ?? null);
    setAiConfig(c?.ai ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  // MinerU 配置状态
  const [editing, setEditing] = useState(false);
  const [mineruToken, setMineruToken] = useState('');
  const [saving, setSaving] = useState(false);

  // Tavily(Aurora 联网搜索)配置状态
  const [editingTavily, setEditingTavily] = useState(false);
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [savingTavily, setSavingTavily] = useState(false);

  // AI 提供商列表操作状态(#5 重构去掉"激活"概念,所有 provider 视可用,agent 自选)
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // System prompt 编辑状态
  const [promptEditing, setPromptEditing] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);

  const resetForm = useCallback(() => {
    setMineruToken('');
    setEditing(false);
  }, []);

  const resetTavilyForm = useCallback(() => {
    setTavilyApiKey('');
    setEditingTavily(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.saveIntegrationConfig({
        mineruToken: mineruToken.trim() || undefined,
      });
      banner.success('集成配置已保存');
      setMineruToken('');
      setEditing(false);
      await loadData(true);
    } catch {
      banner.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTavily = async () => {
    setSavingTavily(true);
    try {
      await settingsApi.saveIntegrationConfig({
        tavilyApiKey: tavilyApiKey.trim() || undefined,
      });
      banner.success('Tavily API key 已保存');
      setTavilyApiKey('');
      setEditingTavily(false);
      await loadData(true);
    } catch {
      banner.error('保存失败');
    } finally {
      setSavingTavily(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await settingsApi.deleteAiProvider(id);
      banner.success('提供商已删除');
      await loadData(true);
    } catch {
      banner.error('删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSavePrompt = async () => {
    setPromptSaving(true);
    try {
      await settingsApi.saveAiSystemPrompt(systemPrompt);
      banner.success('自定义指令已保存');
      setPromptEditing(false);
      await loadData(true);
    } catch {
      banner.error('保存失败');
    } finally {
      setPromptSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader>集成</PageHeader>
        <SectionSkeleton title="MinerU" />
        <SectionSkeleton title="AI 提供商" />
      </div>
    );
  }

  const providers = aiConfig?.providers ?? [];
  // 当前正在编辑的提供商对象
  const editingProvider = providers.find((p) => p.id === editingProviderId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader>集成</PageHeader>

      {/* ── MinerU ── */}
      <EditableSection
        title="MinerU"
        description="PDF 文档解析服务，用于导入功能"
        editing={editing}
        onEdit={() => {
          setMineruToken('');
          setEditing(true);
        }}
        onSave={() => void handleSave()}
        onReset={resetForm}
        saving={saving}
        viewContent={
          <StatusRow
            label="API Token"
            value={config?.hasMineruToken ? '••••••••' : '未配置'}
          />
        }
        editContent={
          <div>
            <FieldLabel>
              API Token
              {config?.hasMineruToken && !mineruToken && (
                <span className="ml-2 font-normal" style={{ color: 'var(--ink-ghost)' }}>
                  已配置，留空则不修改
                </span>
              )}
            </FieldLabel>
            <TextInput
              value={mineruToken}
              onChange={setMineruToken}
              placeholder="eyJ0eXBlIjoi..."
              type="password"
            />
          </div>
        }
      />

      {/* ── Tavily(Aurora 联网搜索)── */}
      <EditableSection
        title="Tavily 联网搜索"
        description="Aurora web_search 工具的 API Key，免费层 1000 次/月"
        editing={editingTavily}
        onEdit={() => {
          setTavilyApiKey('');
          setEditingTavily(true);
        }}
        onSave={() => void handleSaveTavily()}
        onReset={resetTavilyForm}
        saving={savingTavily}
        viewContent={
          <StatusRow
            label="API Key"
            value={config?.hasTavilyApiKey ? '••••••••' : '未配置（web_search 工具不挂载）'}
          />
        }
        editContent={
          <div>
            <FieldLabel>
              API Key
              {config?.hasTavilyApiKey && !tavilyApiKey && (
                <span className="ml-2 font-normal" style={{ color: 'var(--ink-ghost)' }}>
                  已配置，留空则不修改
                </span>
              )}
            </FieldLabel>
            <TextInput
              value={tavilyApiKey}
              onChange={setTavilyApiKey}
              placeholder="tvly-..."
              type="password"
            />
          </div>
        }
      />

      {/* ── AI 提供商列表 ── */}
      <Section
        title="AI 提供商"
        description="配置 API key 和模型 —— 每个提供商绑三档(快/中/深思) + 可选视觉模型。Agent 调用时按它的 tier 自动选用对应模型,换提供商时不用每个 agent 重选模型。配过的都可用,由各 agent 在「Agent」tab 自选用谁。"
      >
        {/* 提供商列表 */}
        {providers.length > 0 ? (
          <div className="space-y-2 mb-4">
            {providers.map((p) => (
              <div key={p.id}>
                <ProviderRow
                  provider={p}
                  onDelete={() => void handleDelete(p.id)}
                  onEdit={() => setEditingProviderId(editingProviderId === p.id ? null : p.id)}
                  deleting={deletingId === p.id}
                />
                {/* 内联编辑表单（仅当前展开的提供商显示） */}
                {editingProviderId === p.id && editingProvider && (
                  <div className="mt-2">
                    <EditProviderForm
                      provider={editingProvider}
                      onSuccess={async () => {
                        setEditingProviderId(null);
                        await loadData(true);
                      }}
                      onCancel={() => setEditingProviderId(null)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          // 空状态
          !showAddForm && (
            <div
              className="mb-4 rounded-lg px-4 py-6 text-center text-sm"
              style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
            >
              尚未配置 AI 提供商
            </div>
          )
        )}

        {/* 添加提供商表单（内联展开） */}
        {showAddForm && (
          <div className="mb-4">
            <AddProviderForm
              onSuccess={async () => {
                setShowAddForm(false);
                await loadData(true);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        {/* 添加按钮 */}
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium transition-opacity duration-100"
            style={{ color: 'var(--ink-faded)' }}
          >
            <Plus size={14} />
            添加提供商
          </button>
        )}
      </Section>

      {/* ── AI 自定义指令（System Prompt） ── */}
      <EditableSection
        title="AI 自定义指令"
        description="追加到 AI 默认角色定义之后，影响所有对话"
        editing={promptEditing}
        onEdit={() => {
          setSystemPrompt(aiConfig?.aiSystemPrompt ?? '');
          setPromptEditing(true);
        }}
        onSave={() => void handleSavePrompt()}
        onReset={() => {
          setSystemPrompt('');
          setPromptEditing(false);
        }}
        saving={promptSaving}
        viewContent={
          <StatusRow
            label="自定义指令"
            value={aiConfig?.aiSystemPrompt ? '已配置' : '未配置（使用默认）'}
          />
        }
        editContent={
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="例如：我是一名软件工程师，主要写技术笔记，请用中文回复"
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--shelf)',
              color: 'var(--ink)',
              border: '1px solid var(--separator)',
              resize: 'vertical',
            }}
          />
        }
      />
    </div>
  );
}
