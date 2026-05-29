/*
 * FolderOverviewPanel — 文件夹着陆页，展示子项概览 + 批量操作入口。
 *
 * 当用户进入文件夹但未选中文档时渲染此面板。
 * 信息层级：文件夹名 → 发布统计 → 操作按钮 → 子项列表
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FolderOpen, FileText, MoreHorizontal } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { useConfirm } from '@/contexts/ConfirmContext';
import { setPendingImportFiles } from '../batch-import-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { structureApi } from '@/services/structure';
import { notesApi } from '@/services/workspace';
import MarkdownBody from '@/components/shared/MarkdownBody';
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
  onEdit: (node: StructureNode) => void;
  onDelete: (node: StructureNode) => void;
  onMoveTo: (node: StructureNode) => void;
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

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

export function FolderOverviewPanel({
  node,
  onSelectNode,
  onEnterFolder,
  onReload,
  onEdit,
  onDelete,
  onMoveTo,
}: FolderOverviewPanelProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [overview, setOverview] = useState<FolderOverview | null>(null);
  /* 节点同质化:文件夹也有自己的正文(各自的 ContentItem),展示在子项列表上方 */
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, detail] = await Promise.all([
        structureApi.getFolderOverview(node.id),
        node.contentItemId
          ? notesApi
              .getById(node.contentItemId, { visibility: 'all' })
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      setOverview(data);
      setBody(detail?.bodyMarkdown ?? '');
    } catch {
      /* 静默失败，显示空状态 */
    } finally {
      setLoading(false);
    }
  }, [node.id, node.contentItemId]);

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
      {/* ---- 标题行：左标题 + 右操作（与 ContentVersionView 对齐） ---- */}
      <div className="flex items-start justify-between">
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
          {/* 发布状态分布 */}
          {stats.docCount > 0 && (
            <div className="mt-2 flex items-center gap-4 text-xs" style={{ color: 'var(--ink-faded)' }}>
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
        </div>

        {/* 操作：高频平铺 + 低频 ··· */}
        <div className="flex items-center gap-2 pt-1">
        {/* 节点同质化(2026-05-29)：文件夹也有自己的正文(各自的 ContentItem)，可直接编辑本主题正文。
            硬跳转规避 Plate 编辑器复用旧实例的底层限制（见 feedback_plate_hard_refresh）。 */}
        {node.contentItemId && (
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
            onClick={() => {
              window.location.href = `/admin/notes/${node.contentItemId}/edit`;
            }}
          >
            编辑正文
          </button>
        )}
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
          onClick={() => folderInputRef.current?.click()}
        >
          导入文件夹
        </button>
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
          onClick={async () => {
            const willPublish = stats.unpublished + stats.updated;
            if (willPublish === 0) {
              banner.success('没有待发布的内容');
              return;
            }
            const ok = await confirm({
              title: '发布全部',
              message: `将发布「${node.name}」下 ${willPublish} 篇文档（${stats.unpublished} 未发布 + ${stats.updated} 有更新）。`,
              confirmLabel: '确认发布',
            });
            if (!ok) return;
            await structureApi.batchPublish(node.id);
            void load();
            onReload();
          }}
        >
          发布全部
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
              style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
            >
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[140px]">
            <DropdownMenuItem
              onClick={async () => {
                if (stats.published === 0) {
                  banner.success('没有已发布的内容');
                  return;
                }
                const ok = await confirm({
                  title: '取消全部发布',
                  message: `将取消「${node.name}」下 ${stats.published} 篇已发布文档的发布状态。`,
                  confirmLabel: '确认取消发布',
                  danger: true,
                });
                if (!ok) return;
                await structureApi.batchUnpublish(node.id);
                void load();
                onReload();
              }}
            >
              取消全部发布
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEdit(node)}>
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMoveTo(node)}>
              移动到...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(node)}
              style={{ color: 'var(--mark-red)' }}
            >
              删除文件夹
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {/* ---- 文件夹自己的正文(若有)：渲染方式与 ContentVersionView 一致 ---- */}
      {body && (
        <div className="text-lg leading-[1.9]">
          <MarkdownBody markdown={body} contentItemId={node.contentItemId} />
        </div>
      )}

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
              {child.type === 'DOC' && (child.summary || child.updatedAt) && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-ghost)' }}>
                  {child.summary}
                  {child.summary && child.updatedAt && ' · '}
                  {child.updatedAt && formatRelativeTime(child.updatedAt)}
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
            banner.error('文件夹中未找到 .md 文件');
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
