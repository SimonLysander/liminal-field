/**
 * /admin/digest — 智能小应用「自动信息收集」事项管理首页（骨架占位）。
 *
 * 业务规划（按 task #34-37 顺序填充）：
 *   - 事项列表：每个事项卡片含 name、cron、订阅源数、最近报告时间、enabled toggle
 *   - 右上按钮：「+ 新建事项」+「信息源」入口（跳 /admin/sources）
 *   - 点击事项卡 → 进事项详情页（配置 + 报告流）
 */
import { Link } from 'react-router-dom';
import { Sparkles, Rss } from 'lucide-react';

export default function DigestAdminPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto flex w-full max-w-[var(--layout-reading-max)] flex-col gap-6 px-10 py-9">
        <header className="flex items-baseline justify-between">
          <div className="flex items-center gap-2.5">
            <Sparkles size={22} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
            <h1 className="text-3xl font-bold" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>
              智能采集
            </h1>
          </div>
          <Link
            to="/admin/digest/sources"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--hover-overlay)]"
            style={{ color: 'var(--ink-faded)' }}
          >
            <Rss size={14} strokeWidth={1.5} />
            信息源
          </Link>
        </header>

        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          配置你的关注事项 — 自动从订阅的信息源里采集、AI 判定相关性、生成报告。报告公开发布到 /digest，追问需登录。
        </p>

        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl py-20"
          style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
        >
          <Sparkles size={32} strokeWidth={1.5} />
          <p className="text-base font-medium">还没有事项</p>
          <p className="text-sm">业务实装中（task #34-37），骨架阶段占位。</p>
        </div>
      </div>
    </div>
  );
}
