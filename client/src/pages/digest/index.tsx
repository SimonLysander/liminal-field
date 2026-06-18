/**
 * /digest — 公开端：智能采集报告首页（骨架占位）。
 *
 * 业务规划（task #38）：
 *   - 列表：所有事项的最新报告，按时间倒序
 *   - 进入单事项：/digest/:topicId
 *   - 报告详情：/digest/:topicId/:reportId
 *   - 报告详情页右栏挂 AdvisorSidebar（report-analyst agent），未登录显示"登录后追问"按钮
 */
import { Sparkles } from 'lucide-react';

export default function DigestPublicPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto flex w-full max-w-[var(--layout-reading-max)] flex-col gap-6 px-10 py-12">
        <div className="flex items-center gap-3">
          <Sparkles size={28} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
          <h1 className="text-4xl font-bold" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>
            精选
          </h1>
        </div>

        <p className="text-base" style={{ color: 'var(--ink-ghost)' }}>
          我关心的话题，每天替我筛选一份精选 — 自动采集 + AI 判定 + Aurora 追问。
        </p>

        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl py-24"
          style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
        >
          <Sparkles size={32} strokeWidth={1.5} />
          <p className="text-base font-medium">还没有报告</p>
          <p className="text-sm">业务实装中（task #38），骨架阶段占位。</p>
        </div>
      </div>
    </div>
  );
}
