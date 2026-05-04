/**
 * MetadataFields / PhotoMetadataFields — 画廊元数据输入组件
 *
 * 使用项目 UI 组件（Input、Calendar、Popover）+ Apple Photos 信息面板风格：
 * - 标签淡灰小字在上，值在下
 * - 日期用 Popover + Calendar（shadcn），不用浏览器原生 date picker
 * - 文本输入用项目 Input 组件，metadata-input 样式覆盖去掉 border
 */

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/* ─── 帖子级：日期 + 地点 ─── */

interface MetadataFieldsProps {
  date: string | null;
  location: string | null;
  onDateChange: (v: string | null) => void;
  onLocationChange: (v: string | null) => void;
}

export function MetadataFields({ date, location, onDateChange, onLocationChange }: MetadataFieldsProps) {
  const [calOpen, setCalOpen] = useState(false);

  /* 将 YYYY-MM-DD 字符串转为 Date 对象（Calendar 组件需要） */
  const dateValue = date ? new Date(date + 'T00:00:00') : undefined;

  const handleDateSelect = (day: Date | undefined) => {
    if (day) {
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, '0');
      const dd = String(day.getDate()).padStart(2, '0');
      onDateChange(`${yyyy}-${mm}-${dd}`);
    } else {
      onDateChange(null);
    }
    setCalOpen(false);
  };

  return (
    <div className="flex items-end gap-8">
      {/* 日期：Popover + Calendar */}
      <FieldGroup label="日期" className="w-[180px]">
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              className="metadata-input flex w-full items-center gap-1.5 text-left"
              style={{ color: date ? 'var(--ink)' : 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}
            >
              <CalendarDays size={13} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)', flexShrink: 0 }} />
              {date ?? '选择日期'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateValue}
              onSelect={handleDateSelect}
              defaultMonth={dateValue}
            />
          </PopoverContent>
        </Popover>
      </FieldGroup>

      {/* 地点：自由文本 */}
      <FieldGroup label="地点" className="w-[200px]">
        <Input
          type="text"
          value={location ?? ''}
          onChange={(e) => onLocationChange(e.target.value || null)}
          placeholder="北京"
          className="metadata-input"
        />
      </FieldGroup>
    </div>
  );
}

/* ─── 照片级：EXIF 拍摄参数 ─── */

const TEXT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'device', label: '设备', placeholder: 'GR III' },
  { key: 'aperture', label: '光圈', placeholder: 'f/2.8' },
  { key: 'shutter', label: '快门', placeholder: '1/250s' },
  { key: 'iso', label: 'ISO', placeholder: '400' },
  { key: 'focalLength', label: '焦距', placeholder: '28mm' },
];

interface PhotoMetadataFieldsProps {
  tags: Record<string, string>;
  onChange: (tags: Record<string, string>) => void;
}

export function PhotoMetadataFields({ tags, onChange }: PhotoMetadataFieldsProps) {
  const [shotAtCalOpen, setShotAtCalOpen] = useState(false);

  const handleChange = (key: string, value: string) => {
    const next = { ...tags };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onChange(next);
  };

  const shotAtDate = tags.shotAt ? new Date(tags.shotAt + 'T00:00:00') : undefined;

  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
      {/* 拍摄时间：Calendar 选择器 */}
      <FieldGroup label="拍摄时间">
        <Popover open={shotAtCalOpen} onOpenChange={setShotAtCalOpen}>
          <PopoverTrigger asChild>
            <button
              className="metadata-input flex w-full items-center gap-1.5 text-left"
              style={{ color: tags.shotAt ? 'var(--ink)' : 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}
            >
              <CalendarDays size={12} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)', flexShrink: 0 }} />
              {tags.shotAt ?? '选择'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={shotAtDate}
              onSelect={(day) => {
                if (day) {
                  const yyyy = day.getFullYear();
                  const mm = String(day.getMonth() + 1).padStart(2, '0');
                  const dd = String(day.getDate()).padStart(2, '0');
                  handleChange('shotAt', `${yyyy}-${mm}-${dd}`);
                } else {
                  handleChange('shotAt', '');
                }
                setShotAtCalOpen(false);
              }}
              defaultMonth={shotAtDate}
            />
          </PopoverContent>
        </Popover>
      </FieldGroup>

      {/* 其余文本字段 */}
      {TEXT_FIELDS.map(({ key, label, placeholder }) => (
        <FieldGroup key={key} label={label}>
          <Input
            type="text"
            value={tags[key] ?? ''}
            onChange={(e) => handleChange(key, e.target.value)}
            placeholder={placeholder}
            className="metadata-input"
          />
        </FieldGroup>
      ))}
    </div>
  );
}

/* ─── 共用 ─── */

function FieldGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="mb-0.5 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
        {label}
      </div>
      {children}
    </div>
  );
}
