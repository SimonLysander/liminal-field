/*
 * OwnerTab — 所有者身份 + 记忆管理 tab
 *
 * 三个区块：
 * 1. 基本信息 — 昵称 + 生日 + 个人简介 + 关注领域，存 system_config.ownerProfile
 * 2. 关于我（user 记忆） — agent 对所有者的认知
 * 3. 项目记忆（project 记忆） — agent 对所有者项目/内容的认知
 *
 * 组件自包含：内部独立 fetch，不依赖父组件传入数据。
 */

import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, X, Check } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import {
  listMemories,
  updateMemory,
  deleteMemory,
  type MemoryItem,
} from '@/services/agent';
import {
  PageHeader,
  EditableSection,
  Section,
  SectionSkeleton,
  FieldLabel,
  TextInput,
} from './SettingsUI';

// ── 基本信息区块 ────────────────────────────────────────────

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p
        className="mt-1 text-sm"
        style={{ color: value ? 'var(--ink)' : 'var(--ink-ghost)' }}
      >
        {value || '未设置'}
      </p>
    </div>
  );
}

interface ProfileData {
  name: string;
  birthday: string;
  bio: string;
  interests: string;
}

const EMPTY_PROFILE: ProfileData = { name: '', birthday: '', bio: '', interests: '' };

function ProfileSection() {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [draft, setDraft] = useState<ProfileData>(EMPTY_PROFILE);

  const isEmpty = !profile.name && !profile.birthday && !profile.bio && !profile.interests;

  const load = useCallback(async () => {
    try {
      const data = await settingsApi.getOwnerProfile();
      setProfile(data);
      setDraft(data);
      // 首次全空时自动进入编辑模式
      if (!data.name && !data.birthday && !data.bio && !data.interests) {
        setEditing(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.saveOwnerProfile(draft);
      setProfile(draft);
      setEditing(false);
      banner.success('已保存');
    } catch {
      banner.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SectionSkeleton title="基本信息" />;

  return (
    <EditableSection
      title="基本信息"
      description="Agent 会在对话中知道你是谁，据此调整建议的风格和方向"
      editing={editing}
      onEdit={() => { setDraft(profile); setEditing(true); }}
      onSave={() => void handleSave()}
      onReset={() => { if (!isEmpty) setEditing(false); }}
      saving={saving}
      canSave={draft.name.trim().length > 0}
      viewContent={
        <div className="space-y-3">
          <ProfileField label="昵称" value={profile.name} />
          <ProfileField label="生日" value={profile.birthday} />
          <ProfileField label="个人简介" value={profile.bio} />
          <ProfileField label="关注领域" value={profile.interests} />
        </div>
      }
      editContent={
        <div className="space-y-4">
          <div>
            <FieldLabel>昵称</FieldLabel>
            <TextInput
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="你的名字或昵称"
            />
          </div>
          <div>
            <FieldLabel>生日</FieldLabel>
            <input
              type="date"
              value={draft.birthday}
              onChange={(e) => setDraft((d) => ({ ...d, birthday: e.target.value }))}
              className="mt-1 h-9 w-full rounded-lg px-3 text-sm outline-none"
              style={{
                background: 'var(--shelf)',
                color: 'var(--ink)',
                border: '1px solid var(--separator)',
              }}
            />
          </div>
          <div>
            <FieldLabel>个人简介</FieldLabel>
            <textarea
              value={draft.bio}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
              placeholder="你的基础能力，如：前端开发、摄影、写作..."
              rows={2}
              className="mt-1 w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--shelf)',
                color: 'var(--ink)',
                border: '1px solid var(--separator)',
              }}
            />
          </div>
          <div>
            <FieldLabel>关注领域</FieldLabel>
            <TextInput
              value={draft.interests}
              onChange={(v) => setDraft((d) => ({ ...d, interests: v }))}
              placeholder="如：计算机科学、文学、城市骑行"
            />
          </div>
        </div>
      }
    />
  );
}

// ── 记忆列表（按类型分区） ──────────────────────────────────────

/** 单条记忆：标题 + 内容预览 + hover 操作 */
function MemoryRow({
  memory,
  onUpdate,
  onDelete,
}: {
  memory: MemoryItem;
  onUpdate: (id: string, data: { type?: string; title?: string; content?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: memory.title,
    content: memory.content,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(memory._id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除记忆「${memory.title}」？`)) return;
    await onDelete(memory._id);
  };

  if (editing) {
    return (
      <div
        className="rounded-lg p-3"
        style={{ background: 'var(--shelf)', border: '1px solid var(--separator)' }}
      >
        <div className="space-y-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="h-7 w-full rounded px-2 text-sm font-medium outline-none"
            style={{
              background: 'var(--paper)',
              color: 'var(--ink)',
              border: '1px solid var(--separator)',
            }}
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            rows={3}
            className="w-full resize-none rounded px-2 py-1.5 text-sm outline-none"
            style={{
              background: 'var(--paper)',
              color: 'var(--ink)',
              border: '1px solid var(--separator)',
            }}
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !draft.title.trim()}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-opacity disabled:opacity-40"
              style={{ color: 'var(--ink)', background: 'var(--paper)' }}
            >
              <Check size={12} /> 保存
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-opacity disabled:opacity-40"
              style={{ color: 'var(--ink-faded)' }}
            >
              <X size={12} /> 取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-3 py-2.5"
      style={{ borderBottom: '0.5px solid var(--separator)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          {memory.title}
        </div>
        <p
          className="mt-0.5 text-xs leading-relaxed"
          style={{ color: 'var(--ink-faded)' }}
        >
          {memory.content.length > 150
            ? memory.content.slice(0, 150) + '...'
            : memory.content}
        </p>
      </div>

      {/* 操作按钮（hover 显示） */}
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => {
            setDraft({ title: memory.title, content: memory.content });
            setEditing(true);
          }}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--ink-ghost)' }}
          title="编辑"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={() => void handleDelete()}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--mark-red)' }}
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** 按类型过滤的记忆分区 */
function MemoryGroup({
  title,
  description,
  memories,
  onUpdate,
  onDelete,
}: {
  title: string;
  description: string;
  memories: MemoryItem[];
  onUpdate: (id: string, data: { type?: string; title?: string; content?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <Section title={title} description={description}>
      {memories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          暂无记忆
        </p>
      ) : (
        <div>
          {memories.map((m) => (
            <MemoryRow
              key={m._id}
              memory={m}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function MemoriesSection() {
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryItem[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await listMemories();
      setMemories(data);
    } catch {
      // API 不可用时静默降级
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleUpdate = async (
    id: string,
    data: { type?: string; title?: string; content?: string },
  ) => {
    try {
      const updated = await updateMemory(id, data);
      setMemories((prev) => prev.map((m) => (m._id === id ? updated : m)));
      banner.success('已更新');
    } catch {
      banner.error('更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m._id !== id));
      banner.success('已删除');
    } catch {
      banner.error('删除失败');
    }
  };

  if (loading) {
    return (
      <>
        <SectionSkeleton title="关于我" />
        <SectionSkeleton title="项目记忆" />
      </>
    );
  }

  const userMemories = memories.filter((m) => m.type === 'user');
  const projectMemories = memories.filter((m) => m.type === 'project');

  return (
    <>
      <MemoryGroup
        title="关于我"
        description={`Agent 对你的认知（${userMemories.length} 条）`}
        memories={userMemories}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
      <MemoryGroup
        title="项目记忆"
        description={`Agent 对你的项目和内容的认知（${projectMemories.length} 条）`}
        memories={projectMemories}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </>
  );
}

// ── 主组件 ──────────────────────────────────────────────────

export function OwnerTab() {
  return (
    <div>
      <PageHeader>所有者</PageHeader>
      <div className="space-y-6">
        <ProfileSection />
        <MemoriesSection />
      </div>
    </div>
  );
}
