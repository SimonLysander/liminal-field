/**
 * CommitForm — 「提交版本」就近浮层内容(笔记/文集编辑器共用)。
 *
 * 放在 <Popover> 内,从编辑器顶栏「提交」按钮锚定弹出。
 * Enter 提交。原先两个编辑器各有一份完全相同的副本,抽到此处去重。
 */

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function CommitForm({
  changeNote,
  onChangeNote,
  onConfirm,
  onCancel,
}: {
  changeNote: string;
  onChangeNote: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 必填：trim 后空就拦住。disabled 控制按钮 + Enter，
  // 用户看到按钮置灰 + placeholder 提示就能理解为什么不能提交，
  // 不需要额外 FieldError 红字（弹窗本身就小，再加一行错误反而吵）。
  const canSubmit = changeNote.trim().length > 0;
  return (
    <div>
      <div className="mb-0.5 text-md font-semibold" style={{ color: 'var(--ink)' }}>提交版本</div>
      <p className="mb-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>将当前草稿提交为正式版本</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-2xs font-medium" style={{ color: 'var(--ink-ghost)' }}>变更说明</span>
        <Input
          type="text"
          value={changeNote}
          onChange={(e) => onChangeNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onConfirm(); }}
          placeholder="例如：补充第三章 / 修笔误 / 重排结构"
          autoFocus
        />
      </label>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>取消</Button>
        <Button variant="primary" size="sm" type="button" disabled={!canSubmit} onClick={onConfirm}>确认提交</Button>
      </div>
    </div>
  );
}
