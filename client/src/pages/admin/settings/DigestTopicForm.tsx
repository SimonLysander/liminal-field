/**
 * DigestTopicForm — 事项新建/编辑表单（极简版）
 *
 * 用户只需填：事项名 + 任务描述 + 运行节奏（人话下拉）+ 订阅源 + 启用。
 * 去掉了：卷首语、关键词、cron 原始输入框、"AI 判定 Prompt"（统一叫"任务描述"）。
 *
 * Schedule → Cron 转换在前端完成，后端接口不变（仍接 cron + keywords + description）。
 * manual 模式强制 enabled=false 提交（后端 scheduler 看 enabled=false 不注册）。
 */

import { useEffect, useState } from 'react';
import { FieldLabel, PrimaryButton, SecondaryButton } from './SettingsUI';
import { infoSourcesApi, INFO_SOURCE_CATEGORIES, CATEGORY_LABELS } from '@/services/info-sources';
import type { InfoSource } from '@/services/info-sources';
import { cronToSchedule } from './scheduleUtils';
import type { Schedule } from './scheduleUtils';

// ── 接口 ──────────────────────────────────────────────────────────────────────

/** 表单内部状态 */
export interface TopicDraft {
  name: string;
  /** 栏目宗旨 — 给读者看的一句话定位(报纸 standfirst);写进 ContentItem.summary,
   *  公开端 /digest 列表卡片 + /digest/:topicId 栏目报头展示。
   *  ≠ prompt(prompt 是给 agent 的工作指令,文风偏命令式) */
  tagline: string;
  prompt: string;          // 即"任务描述"，对应后端 prompt 字段
  schedule: Schedule;
  sourceIds: string[];
  enabled: boolean;
  maxSteps: number;        // Agent 最大轮次，4 档固定选项
}

/** 父组件编辑模式传入（从 TopicDetail 组装） */
export interface TopicFormInitial {
  name: string;
  description: string;     // 保留但不展示，提交时原样回传
  cron: string;
  keywords: string[];      // 保留但不展示，提交时发空数组
  sourceIds: string[];
  aiPrompt: string;
  enabled: boolean;
  maxSteps?: number;
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const N_DAY_OPTIONS = [2, 3, 7, 14, 30];

const DEFAULT_SCHEDULE: Schedule = { mode: 'daily', hour: 8 };

const inputClass = 'mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputStyle = {
  background: 'var(--paper-white)',
  color: 'var(--ink)',
  border: '1px solid var(--separator)',
};
const selectClass = 'rounded-lg px-3 py-2 text-sm outline-none';

// ── 子组件：运行节奏选择器 ────────────────────────────────────────────────────

function SchedulePicker({
  value,
  onChange,
}: {
  value: Schedule;
  onChange: (s: Schedule) => void;
}) {
  function handleModeChange(mode: string) {
    switch (mode) {
      case 'manual':       onChange({ mode: 'manual' }); break;
      case 'daily':        onChange({ mode: 'daily', hour: 8 }); break;
      case 'weekly':       onChange({ mode: 'weekly', weekday: 1, hour: 8 }); break;
      case 'every-n-days': onChange({ mode: 'every-n-days', intervalDays: 3, hour: 8 }); break;
    }
  }

  return (
    <div className="mt-1 space-y-2">
      {/* 模式下拉 */}
      <select
        value={value.mode}
        onChange={(e) => handleModeChange(e.target.value)}
        className={selectClass}
        style={inputStyle}
      >
        <option value="manual">仅手动触发</option>
        <option value="daily">每天</option>
        <option value="weekly">每周</option>
        <option value="every-n-days">每 N 天</option>
      </select>

      {/* 每天：选小时 */}
      {value.mode === 'daily' && (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
          <span>每天</span>
          <select
            value={value.hour}
            onChange={(e) => onChange({ mode: 'daily', hour: parseInt(e.target.value, 10) })}
            className={selectClass}
            style={inputStyle}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
      )}

      {/* 每周：选周几 + 小时 */}
      {value.mode === 'weekly' && (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
          <span>每周</span>
          <select
            value={value.weekday}
            onChange={(e) =>
              onChange({ mode: 'weekly', weekday: parseInt(e.target.value, 10), hour: value.hour })
            }
            className={selectClass}
            style={inputStyle}
          >
            {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <select
            value={value.hour}
            onChange={(e) =>
              onChange({ mode: 'weekly', weekday: value.weekday, hour: parseInt(e.target.value, 10) })
            }
            className={selectClass}
            style={inputStyle}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
      )}

      {/* 每 N 天：选间隔 + 小时 */}
      {value.mode === 'every-n-days' && (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
          <span>每</span>
          <select
            value={value.intervalDays}
            onChange={(e) =>
              onChange({ mode: 'every-n-days', intervalDays: parseInt(e.target.value, 10), hour: value.hour })
            }
            className={selectClass}
            style={inputStyle}
          >
            {N_DAY_OPTIONS.map((n) => <option key={n} value={n}>{n} 天</option>)}
          </select>
          <select
            value={value.hour}
            onChange={(e) =>
              onChange({ mode: 'every-n-days', intervalDays: value.intervalDays, hour: parseInt(e.target.value, 10) })
            }
            className={selectClass}
            style={inputStyle}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
      )}

      {/* manual 提示 */}
      {value.mode === 'manual' && (
        <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          不自动运行，启用后只能手动触发
        </p>
      )}
    </div>
  );
}

// ── 子组件：按分类挑选信息源 ──────────────────────────────────────────────────

/**
 * CategorySourcePicker — 将信息源按 INFO_SOURCE_CATEGORIES 顺序分段展示，
 * 每段支持「全选 / 取消全选」，单项 checkbox 逐个切换。
 * selected/onToggle/onSelectCategory/onDeselectCategory 均操作 sourceId string[]，
 * 数据结构不变（仍用 sourceIds 物化，不做分类级别的新字段）。
 */
function CategorySourcePicker({
  sources,
  selected,
  onToggle,
  onSelectCategory,
  onDeselectCategory,
}: {
  sources: InfoSource[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectCategory: (ids: string[]) => void;
  onDeselectCategory: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      {INFO_SOURCE_CATEGORIES.map((cat) => {
        const inCat = sources.filter((s) => s.category === cat);
        if (inCat.length === 0) return null;
        const allIds = inCat.map((s) => s.id);
        const allSelected = allIds.every((id) => selected.includes(id));
        return (
          <section key={cat} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                {CATEGORY_LABELS[cat]}（{inCat.length}）
              </h4>
              <button
                type="button"
                onClick={() =>
                  allSelected ? onDeselectCategory(allIds) : onSelectCategory(allIds)
                }
                className="text-xs"
                style={{ color: 'var(--accent)' }}
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {inCat.map((s) => {
                const checked = selected.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm"
                    style={{
                      background: checked ? 'var(--accent-soft, rgba(0,0,0,0.04))' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(s.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ color: 'var(--ink)' }}>
                        {s.name}
                      </div>
                      {s.description && (
                        <div className="truncate text-xs" style={{ color: 'var(--ink-ghost)' }}>
                          {s.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── 主表单 ────────────────────────────────────────────────────────────────────

export function DigestTopicForm({
  initial,
  onSubmit,
  onCancel,
  submitting = false,
}: {
  initial?: TopicFormInitial;
  onSubmit: (draft: TopicDraft) => void;
  onCancel: () => void;
  /** 父组件 API 调用进行时为 true,按钮防重复点击 */
  submitting?: boolean;
}) {
  const [draft, setDraft] = useState<TopicDraft>(() =>
    initial
      ? {
          name: initial.name,
          tagline: initial.description,
          prompt: initial.aiPrompt,
          schedule: cronToSchedule(initial.cron),
          sourceIds: initial.sourceIds,
          enabled: initial.enabled,
          maxSteps: initial.maxSteps ?? 20,
        }
      : {
          name: '',
          tagline: '',
          prompt: '',
          schedule: DEFAULT_SCHEDULE,
          sourceIds: [],
          enabled: true,
          maxSteps: 20,
        },
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
      .then((list) => { if (!cancelled) setSources(list); })
      .catch(() => { if (!cancelled) setSources([]); })
      .finally(() => { if (!cancelled) setSourcesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // manual 模式下 enabled 强制 false 提交
  const isManual = draft.schedule.mode === 'manual';
  const canSubmit = draft.name.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      ...draft,
      enabled: isManual ? false : draft.enabled,
    });
  }

  return (
    <div className="space-y-4">
      {/* 事项名称 */}
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

      {/* 栏目宗旨 — 给"读者"看的 (与下面的"任务描述"区分) */}
      <div>
        <FieldLabel>
          栏目宗旨 <span className="ml-2 text-xs" style={{ color: 'var(--accent)' }}>给读者</span>
        </FieldLabel>
        <input
          type="text"
          value={draft.tagline}
          onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
          placeholder="一句话定位 — 公开端栏目页展示给读者看(如:为关注 AI 工程落地的开发者每天精选一份内容)"
          maxLength={120}
          className={inputClass}
          style={inputStyle}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          报刊业内叫 standfirst — 紧贴栏目大字下方那行 italic 副标,告诉读者"这个栏目讲什么、为谁讲"。
        </p>
      </div>

      {/* 任务描述 — 给"AI agent"看的 (跟栏目宗旨完全不同语义) */}
      <div>
        <FieldLabel>
          任务描述 <span className="ml-2 text-xs" style={{ color: 'var(--accent)' }}>给 agent</span>
        </FieldLabel>
        <textarea
          value={draft.prompt}
          onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
          placeholder="给 AI agent 的工作指令 — 描述你关心什么、什么算相关(如:关注 AI 应用进展、Agent 框架、大模型新发布,倾向工程实操,不要纯学术)"
          rows={6}
          className={inputClass}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          AI agent 跑工作流时按这段指令判定"什么 finding 算相关",**不会**展示给读者。
        </p>
      </div>

      {/* 运行节奏 */}
      <div>
        <FieldLabel>运行节奏</FieldLabel>
        <SchedulePicker
          value={draft.schedule}
          onChange={(s) => setDraft((d) => ({ ...d, schedule: s }))}
        />
      </div>

      {/* Agent 最大轮次 — 4 档固定选项，不允许自由输入 */}
      <div>
        <FieldLabel>
          Agent 最大轮次
          <span className="ml-2 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            （{draft.maxSteps} 轮 · 每轮可调多个工具）
          </span>
        </FieldLabel>
        <select
          value={draft.maxSteps}
          onChange={(e) => setDraft((d) => ({ ...d, maxSteps: parseInt(e.target.value, 10) }))}
          className={selectClass}
          style={inputStyle}
        >
          <option value={10}>10 轮（轻量）</option>
          <option value={20}>20 轮（默认）</option>
          <option value={30}>30 轮（深挖）</option>
          <option value={50}>50 轮（重度研究）</option>
        </select>
      </div>

      {/* 订阅信息源 — 按分类展示 checkbox 列表，支持分类级全选/取消全选 */}
      <div>
        <FieldLabel>
          订阅信息源
          {draft.sourceIds.length > 0 && (
            <span className="ml-2 text-xs" style={{ color: 'var(--ink-ghost)' }}>
              已选 {draft.sourceIds.length} 个
            </span>
          )}
        </FieldLabel>
        {sourcesLoading ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            加载信息源…
          </p>
        ) : sources.length === 0 ? (
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            暂无信息源，请先在「信息源」Tab 添加
          </p>
        ) : (
          <div className="mt-2">
            <CategorySourcePicker
              sources={sources}
              selected={draft.sourceIds}
              onToggle={(id) =>
                setDraft((d) => ({
                  ...d,
                  sourceIds: d.sourceIds.includes(id)
                    ? d.sourceIds.filter((x) => x !== id)
                    : [...d.sourceIds, id],
                }))
              }
              onSelectCategory={(ids) =>
                setDraft((d) => ({
                  ...d,
                  sourceIds: Array.from(new Set([...d.sourceIds, ...ids])),
                }))
              }
              onDeselectCategory={(ids) =>
                setDraft((d) => ({
                  ...d,
                  sourceIds: d.sourceIds.filter((x) => !ids.includes(x)),
                }))
              }
            />
          </div>
        )}
      </div>

      {/* 启用（manual 模式不可操作，且始终为 false） */}
      <div className="flex items-center gap-3">
        <FieldLabel>启用</FieldLabel>
        <button
          type="button"
          role="switch"
          aria-checked={isManual ? false : draft.enabled}
          disabled={isManual}
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
          className="relative h-5 w-9 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: (!isManual && draft.enabled) ? 'var(--accent)' : 'var(--separator)' }}
          title={isManual ? '手动触发模式下无法启用自动运行' : undefined}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150"
            style={{ left: (!isManual && draft.enabled) ? '1.125rem' : '0.125rem' }}
          />
        </button>
        {isManual && (
          <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            手动触发模式，自动运行不可用
          </span>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        {/* submitting 期间 disable + 文案变化,防止多点击连续触发 N 次 onSubmit */}
        <PrimaryButton onClick={handleSubmit} disabled={!canSubmit || submitting}>
          {submitting ? (initial ? '保存中…' : '创建中…') : (initial ? '保存' : '创建')}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={submitting}>取消</SecondaryButton>
      </div>
    </div>
  );
}
