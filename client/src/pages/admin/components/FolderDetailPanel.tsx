/*
 * FolderDetailPanel — Folder node metadata display
 *
 * Info cards use rounded-xl and shelf background.
 * Font sizes: heading text-2xl, labels text-2xs, values text-xs/text-sm.
 */

import { formatDate } from '../helpers';
import type { StructureNode } from '@/services/structure';

export const FolderDetailPanel = ({ node }: { node: StructureNode | null }) => {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>
          未选择文件夹
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2
          className="font-semibold"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}
        >
          {node.name}
        </h2>
        <p className="mt-1" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}>
          文件夹节点 · 仅用于组织树结构
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3.5" style={{ background: 'var(--shelf)' }}>
          <div className="font-medium" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
            节点 ID
          </div>
          <div
            className="mt-1"
            style={{ color: 'var(--ink)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}
          >
            {node.id}
          </div>
        </div>
        <div className="rounded-xl p-3.5" style={{ background: 'var(--shelf)' }}>
          <div className="font-medium" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
            更新时间
          </div>
          <div className="mt-1" style={{ color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
            {formatDate(node.updatedAt)}
          </div>
        </div>
      </div>
    </div>
  );
};
