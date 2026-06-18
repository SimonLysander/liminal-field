/**
 * /admin/sources — 信息源管理（骨架占位）。
 *
 * 业务规划（task #34）：
 *   - 列表：每个 source 卡片含 name、type chip、enabled toggle、最后抓取时间
 *   - 新建/编辑浮层：type 选择（首期只 rss）→ url 输入 → 命名 → 测试拉取
 *   - 删除前提示：被几个事项订阅了，删除会影响哪些
 *
 * 全局共用：一个源可被多事项订阅，不属于任何一个事项。
 */
import { Link } from 'react-router-dom';
import { ChevronLeft, Rss } from 'lucide-react';

export default function SourcesAdminPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto flex w-full max-w-[var(--layout-reading-max)] flex-col gap-6 px-10 py-9">
        <header className="flex items-center gap-2">
          <Link
            to="/admin/digest"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors hover:bg-[var(--hover-overlay)]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            <ChevronLeft size={14} strokeWidth={1.5} />
            返回智能采集
          </Link>
        </header>

        <div className="flex items-center gap-2.5">
          <Rss size={22} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
          <h1 className="text-3xl font-bold" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>
            信息源
          </h1>
        </div>

        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          全局共用 — 一个源可以被多个事项订阅，不重复抓取。首期实现 RSS / Atom，后续扩展网页 / API / 邮件订阅。
        </p>

        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl py-20"
          style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
        >
          <Rss size={32} strokeWidth={1.5} />
          <p className="text-base font-medium">还没有信息源</p>
          <p className="text-sm">业务实装中（task #34），骨架阶段占位。</p>
        </div>
      </div>
    </div>
  );
}
