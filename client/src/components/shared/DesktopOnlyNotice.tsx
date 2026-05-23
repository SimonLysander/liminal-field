import { Monitor } from 'lucide-react';

/**
 * DesktopOnlyNotice — 管理端移动端拦截页
 *
 * 设计决策(见 design-system 响应式分治):管理端 + 编辑器为桌面优先,
 * 移动端不适配,在 AuthGuard 处统一拦截 → 引导回移动友好的展示端。
 */
export function DesktopOnlyNotice() {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center px-8 text-center"
      style={{ background: 'var(--paper)' }}
    >
      <Monitor size={40} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
      <h1 className="mt-5 text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        管理端需要电脑访问
      </h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
        编辑与管理功能专为桌面设计,请用电脑打开以获得完整体验。
      </p>
      <a href="/home" className="mt-6 text-sm font-medium" style={{ color: 'var(--accent)' }}>
        返回首页 →
      </a>
    </div>
  );
}
