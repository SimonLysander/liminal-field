/*
 * SkillsTab — 全局 Skill 管理 tab
 *
 * 列表展示所有 Skill,行内显式按钮做编辑 / 删除(不做整行 hover 点击,
 * 遵循 feedback_no_card_hover_clickable:管理端表格行操作走明确按钮)。
 *
 * 编辑用 Dialog 居中弹窗(长表单 + 大 body textarea 适合居中,屉式
 * 在窄屏会挤);删除走 alert-dialog 二次确认。
 *
 * requiredTools 用 <ChipSelector>(全局共享原子)从系统工具池里选,
 * available 走 settingsApi.getAvailableTools()。
 *
 * 数据契约:client/src/services/skills.ts
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §6.2
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { banner } from '@/components/ui/banner-api';
import { ChipSelector } from '@/components/shared/ChipSelector';
import { skillsApi } from '@/services/skills';
import type { Skill, CreateSkillInput } from '@/services/skills';
import { settingsApi } from '@/services/settings';
import type { ToolCatalogEntry } from '@/services/settings';
import {
  FieldLabel,
  TextInput,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from './SettingsUI';

// ── name slug 校验 ──────────────────────────────────────────────
// 跟后端 CreateSkillDto 同款 regex(spec §4.1)。
// 小写字母起头,允许 - _ 数字,2-41 字符。
const NAME_REGEX = /^[a-z][a-z0-9_-]{1,40}$/;

/** 表单空白草稿 — 新建时初始化 */
const EMPTY_DRAFT: CreateSkillInput = {
  name: '',
  displayName: '',
  description: '',
  whenToUse: '',
  body: '',
  requiredTools: [],
};

/**
 * Skill 编辑 / 新建表单 — 共用一份 UI。
 * 新建时 initial = undefined;编辑时 initial = 已有 Skill。
 *
 * 表单提交校验:
 *   - 新建:name 必须匹配 slug 正则,且 displayName/description/whenToUse/body 非空
 *   - 编辑:跟新建同款校验(后端也会校验,前端先挡一道)
 */
function SkillForm({
  initial,
  availableTools,
  toolCatalog,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: Skill;
  availableTools: string[];
  /** slug → 中文名/描述,UI 显示用 */
  toolCatalog: Record<string, ToolCatalogEntry>;
  onSubmit: (input: CreateSkillInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<CreateSkillInput>(() =>
    initial
      ? {
          name: initial.name,
          displayName: initial.displayName,
          description: initial.description,
          whenToUse: initial.whenToUse,
          body: initial.body,
          requiredTools: [...initial.requiredTools],
        }
      : { ...EMPTY_DRAFT },
  );

  const isEditing = !!initial;
  // 内置 skill 由后端文件定义,表单只读
  const isBuiltin = initial?.builtin === true;

  // 前端硬校验 — 后端也校验,这里给即时反馈
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!draft.name) errs.name = 'name 必填';
    else if (!NAME_REGEX.test(draft.name))
      errs.name = '小写字母起头,允许 - _ 数字,2-41 字符';
    if (!draft.displayName) errs.displayName = '展示名必填';
    if (!draft.description) errs.description = '描述必填';
    else if (draft.description.length > 80) errs.description = '≤ 80 字';
    if (!draft.whenToUse) errs.whenToUse = '使用场景必填';
    else if (draft.whenToUse.length > 200) errs.whenToUse = '≤ 200 字';
    if (!draft.body) errs.body = '方法论正文必填';
    return errs;
  }, [draft]);

  const canSubmit = Object.keys(errors).length === 0 && !saving;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(draft);
  };

  return (
    <div className="space-y-4">
      {/* name slug — 编辑时也允许改,后端会检查重名 */}
      <div>
        <FieldLabel>
          name (slug)
          {errors.name && (
            <span
              className="ml-2 font-normal text-xs"
              style={{ color: 'var(--mark-red)' }}
            >
              {errors.name}
            </span>
          )}
        </FieldLabel>
        <TextInput
          value={draft.name}
          onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
          placeholder="critic"
          disabled={saving || isBuiltin}
        />
      </div>

      <div>
        <FieldLabel>
          展示名
          {errors.displayName && (
            <span
              className="ml-2 font-normal text-xs"
              style={{ color: 'var(--mark-red)' }}
            >
              {errors.displayName}
            </span>
          )}
        </FieldLabel>
        <TextInput
          value={draft.displayName}
          onChange={(v) => setDraft((d) => ({ ...d, displayName: v }))}
          placeholder="批评家"
          disabled={saving || isBuiltin}
        />
      </div>

      <div>
        <FieldLabel>
          描述 (≤ 80 字)
          {errors.description && (
            <span
              className="ml-2 font-normal text-xs"
              style={{ color: 'var(--mark-red)' }}
            >
              {errors.description}
            </span>
          )}
        </FieldLabel>
        <TextInput
          value={draft.description}
          onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
          placeholder="一句话说明这个 skill 的作用"
          disabled={saving || isBuiltin}
        />
      </div>

      <div>
        <FieldLabel>
          使用场景 (≤ 200 字)
          {errors.whenToUse && (
            <span
              className="ml-2 font-normal text-xs"
              style={{ color: 'var(--mark-red)' }}
            >
              {errors.whenToUse}
            </span>
          )}
        </FieldLabel>
        <textarea
          value={draft.whenToUse}
          onChange={(e) =>
            setDraft((d) => ({ ...d, whenToUse: e.target.value }))
          }
          placeholder="什么时候该用这个 skill,引导 agent 自动判断"
          rows={2}
          disabled={saving || isBuiltin}
          className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
          style={{
            background: 'var(--paper-white)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
            resize: 'vertical',
          }}
        />
      </div>

      <div>
        <FieldLabel>
          方法论正文 (markdown)
          {errors.body && (
            <span
              className="ml-2 font-normal text-xs"
              style={{ color: 'var(--mark-red)' }}
            >
              {errors.body}
            </span>
          )}
        </FieldLabel>
        <textarea
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          placeholder="agent invoke 这个 skill 时注入的方法论 prompt"
          rows={10}
          disabled={saving || isBuiltin}
          className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-xs outline-none disabled:opacity-50"
          style={{
            background: 'var(--paper-white)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
            resize: 'vertical',
          }}
        />
      </div>

      <div>
        <FieldLabel>必需工具 (requiredTools)</FieldLabel>
        <p className="mt-1 mb-2 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          agent 启用本 skill 时必须已开启这些工具,否则后端拒绝授权。
        </p>
        <div style={{ opacity: isBuiltin ? 0.5 : 1, pointerEvents: isBuiltin ? 'none' : undefined }}>
          <ChipSelector
            selected={draft.requiredTools ?? []}
            available={availableTools}
            renderLabel={(t) => toolCatalog[t]?.displayName ?? t}
            renderMeta={(t) => toolCatalog[t]?.summary}
            onAdd={(t) =>
              setDraft((d) => ({
                ...d,
                requiredTools: [...(d.requiredTools ?? []), t],
              }))
            }
            onRemove={(t) =>
              setDraft((d) => ({
                ...d,
                requiredTools: (d.requiredTools ?? []).filter((x) => x !== t),
              }))
            }
          />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <PrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
          {saving ? '保存中...' : isEditing ? '保存' : '创建'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>
          取消
        </SecondaryButton>
      </div>
    </div>
  );
}

/** 单行 Skill 视觉:displayName + name 副标 + description + 操作按钮(明确而不整行点击) */
function SkillRow({
  skill,
  toolCatalog,
  onEdit,
  onDelete,
}: {
  skill: Skill;
  /** 副标列工具时翻译 slug,找不到 fallback */
  toolCatalog: Record<string, ToolCatalogEntry>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const labelOf = (slug: string) => toolCatalog[slug]?.displayName ?? slug;
  // 内置 skill 由后端文件定义,线上不可编辑/删除
  const isBuiltin = skill.builtin === true;
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
            {skill.displayName}
          </span>
          <span
            className="font-mono text-2xs"
            style={{ color: 'var(--ink-ghost)' }}
          >
            {skill.name}
          </span>
        </div>
        <p
          className="mt-0.5 truncate text-xs"
          style={{ color: 'var(--ink-faded)' }}
          title={skill.description}
        >
          {skill.description}
        </p>
        {skill.requiredTools.length > 0 && (
          <p
            className="mt-1 truncate text-2xs"
            style={{ color: 'var(--ink-ghost)' }}
          >
            需要: {skill.requiredTools.map(labelOf).join('、')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isBuiltin && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-faded)' }}
            title="编辑"
            aria-label={`编辑 ${skill.displayName}`}
          >
            <Pencil size={14} strokeWidth={1.75} />
          </button>
        )}
        {!isBuiltin && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-ghost)' }}
            title="删除"
            aria-label={`删除 ${skill.displayName}`}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * SkillsTab — Settings 页面的「技能」tab。
 *
 * 自包含:内部独立 fetch skill 列表 + 工具池,父组件不传数据。
 * 默认静默刷新(silent=true)避免操作后页面闪屏。
 */
export function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  // slug → 中文名/描述 查找表(找不到 fallback 显 slug,不破老数据)
  const [toolCatalog, setToolCatalog] = useState<Record<string, ToolCatalogEntry>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [skillsRes, toolsRes, catalogRes] = await Promise.allSettled([
      skillsApi.list(),
      settingsApi.getAvailableTools(),
      settingsApi.getToolCatalog(),
    ]);
    if (skillsRes.status === 'fulfilled') {
      setSkills(skillsRes.value);
    } else {
      banner.error('加载技能列表失败');
    }
    if (toolsRes.status === 'fulfilled') {
      setAvailableTools(toolsRes.value);
    }
    if (catalogRes.status === 'fulfilled') {
      setToolCatalog(
        Object.fromEntries(catalogRes.value.map((e) => [e.name, e])),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  const handleCreate = async (input: CreateSkillInput) => {
    setSaving(true);
    try {
      await skillsApi.create(input);
      banner.success(`技能 ${input.displayName} 已创建`);
      setCreating(false);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      banner.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (input: CreateSkillInput) => {
    if (!editing) return;
    setSaving(true);
    try {
      await skillsApi.update(editing._id, input);
      banner.success('已保存');
      setEditing(null);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      banner.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) return;
    setDeleting(true);
    try {
      await skillsApi.delete(confirmingDelete._id);
      banner.success(`技能 ${confirmingDelete.displayName} 已删除`);
      setConfirmingDelete(null);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      banner.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 + 新建按钮 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1
            className="text-base font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            技能
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            可被 Agent 调用的方法论;在 Agent 设置里授权使用。
          </p>
        </div>
        <PrimaryButton onClick={() => setCreating(true)}>
          + 新建技能
        </PrimaryButton>
      </div>
      <Separator />

      {/* 列表 */}
      <section className="space-y-2">
        {loading ? (
          <div
            className="h-16 animate-pulse rounded-lg"
            style={{ background: 'var(--shelf)' }}
          />
        ) : skills.length > 0 ? (
          skills.map((skill) => (
            <SkillRow
              key={skill._id}
              skill={skill}
              toolCatalog={toolCatalog}
              onEdit={() => setEditing(skill)}
              onDelete={() => setConfirmingDelete(skill)}
            />
          ))
        ) : (
          <div
            className="rounded-lg px-3 py-6 text-center text-xs"
            style={{
              color: 'var(--ink-ghost)',
              border: '1px dashed var(--separator)',
            }}
          >
            暂无技能。点右上「新建技能」开始。
          </div>
        )}
      </section>

      {/* 新建 dialog */}
      <Dialog open={creating} onOpenChange={(v) => !v && setCreating(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建技能</DialogTitle>
            <DialogDescription className="sr-only">
              新建一个全局技能,可被 Agent 在设置里授权使用
            </DialogDescription>
          </DialogHeader>
          <SkillForm
            availableTools={availableTools}
            toolCatalog={toolCatalog}
            onSubmit={(input) => void handleCreate(input)}
            onCancel={() => setCreating(false)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* 编辑 dialog */}
      <Dialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑技能</DialogTitle>
            <DialogDescription className="sr-only">
              修改技能内容,改 name 时后端会校验重名
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <SkillForm
              initial={editing}
              availableTools={availableTools}
              toolCatalog={toolCatalog}
              onSubmit={(input) => void handleUpdate(input)}
              onCancel={() => setEditing(null)}
              saving={saving}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 alert-dialog */}
      <AlertDialog
        open={!!confirmingDelete}
        onOpenChange={(v) => !v && setConfirmingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除技能「{confirmingDelete?.displayName}」?
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。所有 Agent 中已启用的引用会被自动清理。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <DangerButton
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? '删除中...' : '删除'}
              </DangerButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
