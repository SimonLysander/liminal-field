/*
 * OwnerTab — 所有者身份(2026-05-31 按 design-language.md 宪法重做)。
 *
 * 抛弃旧 EditableSection 卡片 + 编辑/查看双态:
 * - heading "资料" + 描述 + Separator 分段(不用卡片包裹)
 * - 控件高 28px(Notion 紧凑基准)、字号 14 主/12 次、1px 细边、accent 长春花紫
 * - Save 按钮 bottom-left(GitHub Primer)、dirty 时显示放弃按钮
 * - 全程用 ui/* 标准件,不再自造原子(SettingsUI 自造 atom 是设计漂移根源)
 */

import { useState, useEffect, useCallback } from 'react';
import { CalendarDays } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/services/settings';

interface ProfileData {
  name: string;
  birthday: string;
  bio: string;
}

const EMPTY: ProfileData = { name: '', birthday: '', bio: '' };

/** 紧凑字段:label(12px ink-faded) + 控件 + 可选 helper(12px ink-ghost) */
function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="text-xs font-medium"
        style={{ color: 'var(--ink-faded)' }}
      >
        {label}
      </div>
      {children}
      {helper && (
        <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {helper}
        </div>
      )}
    </div>
  );
}

/** 日期字段 — Popover + Calendar,跟随 ui/input 紧凑基准(h-7、shelf 底、accent focus) */
function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dateValue = value ? new Date(value + 'T00:00:00') : undefined;
  const handleSelect = (day: Date | undefined) => {
    if (day) {
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, '0');
      const dd = String(day.getDate()).padStart(2, '0');
      onChange(`${yyyy}-${mm}-${dd}`);
    } else {
      onChange('');
    }
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-full max-w-md items-center gap-1.5 rounded-sm border border-transparent bg-[var(--shelf)] px-2.5 text-md transition-colors hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none"
          style={{ color: value ? 'var(--ink)' : 'var(--ink-ghost)' }}
        >
          <CalendarDays
            size={14}
            strokeWidth={1.5}
            style={{ color: 'var(--ink-ghost)', flexShrink: 0 }}
          />
          <span>{value || 'yyyy/mm/dd'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          defaultMonth={dateValue}
        />
      </PopoverContent>
    </Popover>
  );
}

export function OwnerTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>(EMPTY);
  const [draft, setDraft] = useState<ProfileData>(EMPTY);

  const dirty =
    profile.name !== draft.name ||
    profile.birthday !== draft.birthday ||
    profile.bio !== draft.bio;

  const load = useCallback(async () => {
    try {
      const data = await settingsApi.getOwnerProfile();
      setProfile(data);
      setDraft(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await settingsApi.saveOwnerProfile(draft);
      setProfile(draft);
      banner.success('已保存');
    } catch {
      banner.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(profile);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div
          className="h-5 w-16 rounded-sm animate-pulse"
          style={{ background: 'var(--shelf)' }}
        />
        <div
          className="h-3 w-40 rounded-sm animate-pulse"
          style={{ background: 'var(--shelf)' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heading + description */}
      <div>
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          资料
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          Agent 会在对话中知道你是谁,据此调整建议的风格和方向
        </p>
      </div>
      <Separator />

      {/* Form fields */}
      <div className="space-y-5">
        <Field label="昵称" helper="你的名字或昵称">
          <Input
            value={draft.name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, name: e.target.value }))
            }
            placeholder="未设置"
            className="max-w-md"
          />
        </Field>

        <Field label="生日">
          <DateField
            value={draft.birthday}
            onChange={(v) => setDraft((d) => ({ ...d, birthday: v }))}
          />
        </Field>

        <Field
          label="个人简介"
          helper="你的基础能力,如:前端开发、摄影、写作"
        >
          <textarea
            value={draft.bio}
            onChange={(e) =>
              setDraft((d) => ({ ...d, bio: e.target.value }))
            }
            rows={3}
            className="flex w-full resize-none rounded-sm border border-transparent bg-[var(--shelf)] px-2.5 py-1.5 text-md transition-colors placeholder:text-[var(--ink-ghost)] hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </Field>
      </div>

      {/* Action — Save 按钮 bottom-left(GitHub Primer);dirty 时显示"放弃" */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
        {dirty && !saving && (
          <Button variant="ghost" onClick={handleDiscard}>
            放弃修改
          </Button>
        )}
      </div>
    </div>
  );
}
