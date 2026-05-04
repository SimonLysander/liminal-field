/**
 * MetadataFields / PhotoMetadataFields — 画廊元数据输入组件
 *
 * 使用项目 Input 组件 + Apple Photos 信息面板风格：
 * - 标签淡灰小字在上，值在下
 * - Input 视觉极简（去 border/ring，focus 时淡底色）
 * - EXIF 字段有格式提示占位符
 */

import { Input } from '@/components/ui/input';

/* ─── 帖子级：日期 + 地点 ─── */

interface MetadataFieldsProps {
  date: string | null;
  location: string | null;
  onDateChange: (v: string | null) => void;
  onLocationChange: (v: string | null) => void;
}

export function MetadataFields({ date, location, onDateChange, onLocationChange }: MetadataFieldsProps) {
  return (
    <div className="flex gap-8">
      <FieldGroup label="日期" className="w-[180px]">
        <Input
          type="date"
          value={date ?? ''}
          onChange={(e) => onDateChange(e.target.value || null)}
          className="metadata-input"
        />
      </FieldGroup>
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

const PHOTO_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'device', label: '设备', placeholder: 'GR III' },
  { key: 'shotAt', label: '拍摄时间', placeholder: '2024-03-15 14:30' },
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
  const handleChange = (key: string, value: string) => {
    const next = { ...tags };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onChange(next);
  };

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-0.5">
      {PHOTO_FIELDS.map(({ key, label, placeholder }) => (
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
