/*
 * OwnerTab — 所有者身份 tab。
 *
 * 只放"你是谁"——昵称 + 生日 + 个人简介,存 system_config.ownerProfile。
 * Agent 对你的认知(user/project 记忆)挪到 AgentTab(见 MemoriesSection.tsx)。
 */

import { useState, useEffect, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import {
  PageHeader,
  EditableSection,
  SectionSkeleton,
  FieldLabel,
  TextInput,
  DatePickerField,
} from './SettingsUI';

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
}

const EMPTY_PROFILE: ProfileData = { name: '', birthday: '', bio: '' };

function ProfileSection() {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [draft, setDraft] = useState<ProfileData>(EMPTY_PROFILE);

  const isEmpty = !profile.name && !profile.birthday && !profile.bio;

  const load = useCallback(async () => {
    try {
      const data = await settingsApi.getOwnerProfile();
      setProfile(data);
      setDraft(data);
      // 首次全空时自动进入编辑模式
      if (!data.name && !data.birthday && !data.bio) {
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
            <DatePickerField
              value={draft.birthday}
              onChange={(v) => setDraft((d) => ({ ...d, birthday: v }))}
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
                background: 'var(--paper-white)',
                color: 'var(--ink)',
                border: '1px solid var(--separator)',
              }}
            />
          </div>
        </div>
      }
    />
  );
}

export function OwnerTab() {
  return (
    <div>
      <PageHeader>所有者</PageHeader>
      <div className="space-y-6">
        <ProfileSection />
      </div>
    </div>
  );
}
