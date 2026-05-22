import { Dot, type DotVariant } from '@/components/ui/dot';

/**
 * SaveStatus — 自动保存状态(L3)
 *
 * 四态一处定义,收编 anthology/edit、DraftWorkspace、FolderOverviewPanel 各自重复的 StatusDot:
 *   saving 进行中 = 主题色脉动点 · saved 成功 = 绿点 · dirty 未保存 = 中性灰点 · error 失败 = 红点
 */
export type SaveState = 'saving' | 'saved' | 'dirty' | 'error';

// 复用 DotVariant,Dot 增减变体时此处类型自动同步,避免两处手写变体名漂移
const SAVE_META: Record<
  SaveState,
  { variant: DotVariant; pulse?: boolean; label: string }
> = {
  saving: { variant: 'accent', pulse: true, label: '保存中…' },
  saved: { variant: 'success', label: '已同步' },
  dirty: { variant: 'neutral', label: '有未保存的更改' },
  error: { variant: 'danger', label: '保存失败' },
};

export function SaveStatus({ state, label }: { state: SaveState; label?: string }) {
  const meta = SAVE_META[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-faded)' }}>
      <Dot variant={meta.variant} pulse={meta.pulse} />
      {label ?? meta.label}
    </span>
  );
}
