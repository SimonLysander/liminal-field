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

/**
 * 字段定义：顺序与收起态一致（大小·分辨率·光圈·快门·ISO·焦距·日期）
 * 大小和分辨率只读，不在此列表；日期用 Calendar 组件单独处理。
 *
 * 用户只输入数字，单位由 prefix/suffix 自动拼接。
 * - 存储格式：f/2.8, 1/250s, 400, 28mm
 * - 输入框显示纯数字部分，前后缀作为视觉提示
 * - pattern 校验的是纯数字输入（不含单位）
 */
const TEXT_FIELDS: {
  key: string;
  label: string;
  placeholder: string;
  prefix?: string;
  suffix?: string;
  /** 校验纯数字输入 */
  pattern: RegExp;
  /** 从存储值中提取纯数字部分 */
  parse: (v: string) => string;
  /** 将纯数字输入转为存储格式 */
  format: (v: string) => string;
}[] = [
  {
    key: 'aperture', label: '光圈', placeholder: '2.8',
    prefix: 'f/',
    pattern: /^\d+(\.\d+)?$/,
    parse: (v) => v.replace(/^f\//, ''),
    format: (v) => v ? `f/${v}` : '',
  },
  {
    key: 'shutter', label: '快门', placeholder: '1/250',
    suffix: 's',
    pattern: /^(1\/\d+|\d+(\.\d+)?)$/,
    parse: (v) => v.replace(/s$/, ''),
    format: (v) => v ? `${v}s` : '',
  },
  {
    key: 'iso', label: 'ISO', placeholder: '400',
    pattern: /^\d+$/,
    parse: (v) => v,
    format: (v) => v,
  },
  {
    key: 'focalLength', label: '焦距', placeholder: '28',
    suffix: 'mm',
    pattern: /^\d+$/,
    parse: (v) => v.replace(/mm$/, ''),
    format: (v) => v ? `${v}mm` : '',
  },
];

interface PhotoMetadataFieldsProps {
  tags: Record<string, string>;
  /** 文件大小（字节），只读展示 */
  fileSize: number;
  /** 图片像素尺寸，只读展示 */
  dimensions: { w: number; h: number } | null;
  onChange: (tags: Record<string, string>) => void;
}

export function PhotoMetadataFields({ tags, fileSize, dimensions, onChange }: PhotoMetadataFieldsProps) {
  const [shotAtCalOpen, setShotAtCalOpen] = useState(false);
  /* 校验错误：key → 是否有错 */
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const handleChange = (key: string, value: string) => {
    const next = { ...tags };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onChange(next);
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: false }));
  };

  /**
   * 带格式的字段变更：用户输入纯数字，存储时拼接单位。
   * blur 时校验格式。
   */
  const handleFieldChange = (key: string, rawInput: string, format: (v: string) => string) => {
    handleChange(key, format(rawInput));
  };

  const handleFieldBlur = (key: string, rawInput: string, pattern: RegExp) => {
    if (rawInput && !pattern.test(rawInput)) {
      setErrors((prev) => ({ ...prev, [key]: true }));
    }
  };

  const shotAtDate = tags.shotAt ? new Date(tags.shotAt + 'T00:00:00') : undefined;

  /* 格式化文件大小 */
  const sizeStr = fileSize < 1024 * 1024
    ? `${(fileSize / 1024).toFixed(1)} KB`
    : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="grid grid-cols-4 gap-x-3 gap-y-1">
      {/* 第一行：大小（只读）、分辨率（只读）、光圈、快门 */}
      <FieldGroup label="大小">
        <div className="metadata-input" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}>
          {sizeStr}
        </div>
      </FieldGroup>

      <FieldGroup label="分辨率">
        <div className="metadata-input" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}>
          {dimensions ? `${dimensions.w}×${dimensions.h}` : '—'}
        </div>
      </FieldGroup>

      {/* 可编辑字段（光圈、快门、ISO、焦距）— 顺序与收起态一致 */}
      {TEXT_FIELDS.map(({ key, label, placeholder, prefix, suffix, pattern, parse, format }) => {
        const rawValue = tags[key] ? parse(tags[key]) : '';
        return (
          <FieldGroup key={key} label={label}>
            <div className="flex items-center gap-0">
              {prefix && (
                <span className="text-xs" style={{ color: 'var(--ink-ghost)', flexShrink: 0 }}>{prefix}</span>
              )}
              <Input
                type="text"
                value={rawValue}
                onChange={(e) => handleFieldChange(key, e.target.value, format)}
                onBlur={(e) => handleFieldBlur(key, e.target.value, pattern)}
                placeholder={placeholder}
                className="metadata-input"
                style={errors[key] ? { borderColor: 'var(--mark-red)', borderWidth: 1, borderStyle: 'solid' } : undefined}
              />
              {suffix && (
                <span className="text-xs" style={{ color: 'var(--ink-ghost)', flexShrink: 0 }}>{suffix}</span>
              )}
            </div>
            {errors[key] && (
              <span className="text-2xs" style={{ color: 'var(--mark-red)' }}>
                格式: {prefix ?? ''}{placeholder}{suffix ?? ''}
              </span>
            )}
          </FieldGroup>
        );
      })}

      {/* 第二行末尾：拍摄日期 */}
      <FieldGroup label="拍摄日期">
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
