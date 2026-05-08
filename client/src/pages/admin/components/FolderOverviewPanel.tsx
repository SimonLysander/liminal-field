/*
 * FolderOverviewPanel — 文件夹着陆页，展示子项概览 + 批量操作入口。
 *
 * 当用户进入文件夹但未选中文档时渲染此面板。
 * 信息层级：文件夹名 → 发布统计 → 操作按钮 → 子项列表
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FolderOpen, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { setPendingImportFiles } from '../batch-import-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { structureApi } from '@/services/structure';
import type {
  StructureNode,
  FolderOverview,
  FolderOverviewChild,
} from '@/services/structure';

interface FolderOverviewPanelProps {
  node: StructureNode;
  onSelectNode: (node: StructureNode) => void;
  onEnterFolder: (node: StructureNode) => void;
  onReload: () => void;
}

/* ---- 发布状态点标记 ---- */

const DOT_STYLE: Record<string, React.CSSProperties> = {
  published: { background: 'var(--mark-green)' },
  updated: { background: 'linear-gradient(135deg, var(--mark-green) 50%, var(--ink-ghost) 50%)' },
  unpublished: { border: '1px solid var(--ink-ghost)', background: 'transparent' },
};

function StatusDot({ status }: { status: FolderOverviewChild['publishStatus'] }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={DOT_STYLE[status ?? 'unpublished']}
    />
  );
}

const STATUS_LABEL: Record<string, string> = {
  published: '已发布',
  updated: '有更新',
  unpublished: '未发布',
};

/** 文件夹子项的发布统计后缀（"全部已发布" / "N 篇已发布" / 空） */
function formatPublishSuffix(published: number | undefined, total: number): string {
  if (!published) return '';
  if (published === total) return ' · 全部已发布';
  return ` · ${published} 篇已发布`;
}

export function FolderOverviewPanel({
  node,
  onSelectNode,
  onEnterFolder,
  onReload,
}: FolderOverviewPanelProps) {
  const navigate = useNavigate();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [overview, setOverview] = useState<FolderOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await structureApi.getFolderOverview(node.id);
      setOverview(data);
    } catch {
      /* 静默失败，显示空状态 */
    } finally {
      setLoading(false);
    }
  }, [node.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步数据加载
    void load();
  }, [load]);

  /* ---- 子项点击 ---- */

  const handleChildClick = useCallback(
    (child: FolderOverviewChild) => {
      if (child.type === 'FOLDER') {
        // 构造最小的 StructureNode 用于 enterFolder
        onEnterFolder({
          id: child.id,
          name: child.name,
          type: 'FOLDER',
          sortOrder: 0,
          hasChildren: true,
          createdAt: '',
        });
      } else if (child.contentItemId) {
        onSelectNode({
          id: child.id,
          name: child.name,
          type: 'DOC',
          contentItemId: child.contentItemId,
          sortOrder: 0,
          hasChildren: false,
          createdAt: '',
        });
      }
    },
    [onEnterFolder, onSelectNode],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          加载中…
        </p>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          加载失败
        </p>
      </div>
    );
  }

  const { stats, children } = overview;

  return (
    <div className="space-y-6">
      {/* ---- 标题 + 统计 ---- */}
      <div>
        <h2
          className="text-2xl font-semibold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          {node.name}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-faded)' }}>
          {stats.folderCount > 0 && `${stats.folderCount} 个子文件夹 · `}
          {stats.docCount} 篇文档
        </p>
      </div>

      {/* ---- 发布状态分布 ---- */}
      {stats.docCount > 0 && (
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--ink-faded)' }}>
          {stats.published > 0 && (
            <span className="flex items-center gap-1.5">
              <StatusDot status="published" />
              {stats.published} 已发布
            </span>
          )}
          {stats.updated > 0 && (
            <span className="flex items-center gap-1.5">
              <StatusDot status="updated" />
              {stats.updated} 有更新
            </span>
          )}
          {stats.unpublished > 0 && (
            <span className="flex items-center gap-1.5">
              <StatusDot status="unpublished" />
              {stats.unpublished} 未发布
            </span>
          )}
        </div>
      )}

      {/* ---- 操作按钮 ---- */}
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
          onClick={() => folderInputRef.current?.click()}
        >
          导入文件夹
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
            >
              发布全部 ▾
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            <DropdownMenuItem
              onClick={async () => {
                const result = await structureApi.batchPublish(node.id);
                toast.success(`已发布 ${result.successCount} 篇，跳过 ${result.skippedCount} 篇`);
                void load();
                onReload();
              }}
            >
              发布全部
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const result = await structureApi.batchUnpublish(node.id);
                toast.success(`已取消发布 ${result.successCount} 篇，跳过 ${result.skippedCount} 篇`);
                void load();
                onReload();
              }}
            >
              取消全部发布
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ---- 分隔线 ---- */}
      {children.length > 0 && (
        <div style={{ borderTop: '0.5px solid var(--separator)' }} />
      )}

      {/* ---- 子项列表 ---- */}
      <div className="space-y-0.5">
        {children.map((child) => (
          <button
            key={child.id}
            className="hover-shelf flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
            style={{ color: 'var(--ink)' }}
            onClick={() => handleChildClick(child)}
          >
            {/* 图标 */}
            {child.type === 'FOLDER' ? (
              <FolderOpen size={16} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
            ) : (
              <FileText size={16} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
            )}

            {/* 名称 + 摘要/统计 */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{child.name}</div>
              {child.type === 'FOLDER' && child.childDocCount != null && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-ghost)' }}>
                  {child.childDocCount} 篇
                  {formatPublishSuffix(child.childPublishedCount, child.childDocCount!)}
                </p>
              )}
              {child.type === 'DOC' && child.summary && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-ghost)' }}>
                  {child.summary}
                </p>
              )}
            </div>

            {/* 右侧：状态标记或箭头 */}
            {child.type === 'DOC' && child.publishStatus && (
              <span className="flex items-center gap-1.5 shrink-0 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                <StatusDot status={child.publishStatus} />
                {STATUS_LABEL[child.publishStatus]}
              </span>
            )}
            {child.type === 'FOLDER' && (
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
            )}
          </button>
        ))}
      </div>

      {children.length === 0 && (
        <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-ghost)' }}>
          空文件夹
        </p>
      )}

      {/* Hidden folder input — 只做客户端文件读取，立即跳转到预览页 */}
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitdirectory 非标准属性
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;

          // 检查是否有 .md 文件
          let hasMd = false;
          for (let i = 0; i < files.length; i++) {
            if (files[i].webkitRelativePath.endsWith('.md')) {
              hasMd = true;
              break;
            }
          }
          if (!hasMd) {
            toast.error('文件夹中未找到 .md 文件');
            e.target.value = '';
            return;
          }

          // FileList 不支持 structured clone，存到模块变量
          setPendingImportFiles(files);
          const params = new URLSearchParams({
            parentId: node.id,
            parentName: node.name,
          });
          navigate(`/admin/notes/batch-import?${params.toString()}`);

          e.target.value = '';
        }}
      />
    </div>
  );
}
