/**
 * LocationInput / DateInput — 画廊元数据行内输入组件。
 *
 * 原 LocationSelect（固定下拉列表）改为自由文本输入，以配合 frontmatter 协议
 * 将 location 提升为一级字段、支持任意地点文本的变更。
 * DateInput 同样使用药丸形样式，与 LocationInput 并排放置。
 */

/** 地点自由文本输入，药丸形样式 */
export function LocationInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder="添加地点"
      className="w-fit rounded-full px-3 py-1 text-xs"
      style={{ background: 'var(--shelf)', color: 'var(--ink)', border: 'none', outline: 'none' }}
    />
  );
}

/** 日期输入，药丸形样式 */
export function DateInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-fit rounded-full px-3 py-1 text-xs"
      style={{ background: 'var(--shelf)', color: 'var(--ink)', border: 'none', outline: 'none' }}
    />
  );
}
