/**
 * AnthologySidePanel — 右栏第一级：文集信息面板
 *
 * 只保留：文集描述编辑 + 条目数统计。
 * 发布/删除操作已移至中栏标题行（与 Notes 对齐），此处不再重复。
 */

import type { AnthologyAdminDetail } from '@/services/workspace';
import { SectionLabel, InfoRow } from './primitives';

interface AnthologySidePanelProps {
  detail: AnthologyAdminDetail;
}

export function AnthologySidePanel({ detail }: AnthologySidePanelProps) {
  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden px-5 py-7"
      style={{ width: 'var(--layout-context)' }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 概览信息区块 */}
        <div className="mb-5 shrink-0">
          <SectionLabel>概览</SectionLabel>
          <div className="space-y-1.5">
            <InfoRow label="条目数" value={`${detail.entries.length} 篇`} />
            <InfoRow
              label="状态"
              value={detail.status === 'published' ? '已发布' : '未发布'}
            />
          </div>
        </div>

        {/* 描述区块 — 若有描述则显示，后续可扩展为 inline 编辑 */}
        {detail.description ? (
          <div className="mb-5 shrink-0">
            <SectionLabel>简介</SectionLabel>
            <p className="leading-relaxed" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-xs)' }}>
              {detail.description}
            </p>
          </div>
        ) : (
          <div className="mb-5 shrink-0">
            <SectionLabel>简介</SectionLabel>
            <p style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>暂无简介</p>
          </div>
        )}
      </div>
    </aside>
  );
}
