/*
 * GalleryEditPage — 画廊动态编辑页 (/admin/gallery/:id/edit)
 *
 * 布局:
 *   浮动胶囊顶栏(左:导航,右:主题切换 + 操作按钮)
 *   滚动内容区(--layout-reading-max 居中):PhotoRowEditor + MetadataFields
 *     caption/EXIF 在 PhotoRowEditor 行内 inline 编辑;看大图走 Lightbox(纯展示)
 *   右侧 AdvisorSidebar(配了视觉模型才挂)
 *
 * 进入此页面时 id 必定存在(从列表页创建后跳转而来)。
 * 所有编辑通过 draft 自动保存,"提交"触发首次/新版本 Git commit。
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Sun, Moon, Trash2, MoreHorizontal } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { useConfirm } from '@/contexts/ConfirmContext';
import { galleryApi } from '@/services/workspace';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/LoadingState';
import { PhotoRowEditor } from './components/PhotoRowEditor';
import { MetadataFields } from './components/LocationSelect';
import { CommitPopover } from './components/CommitPopover';
import { InlineCaptionCard } from './components/InlineCaptionCard';
import { AdvisorSidebar } from '@/components/ai-advisor/AdvisorSidebar';
import { useGalleryEditor } from './hooks/useGalleryEditor';
import { settingsApi } from '@/services/settings';

// ─── 保存状态展示 ───

/*
 * SaveStatusBadge — 保存状态,与笔记/文集编辑器统一:
 *   只两态——保存中(长春花紫呼吸点)/ 已自动保存。不显示"未保存"(自动保存会很快落)。
 */
function SaveStatusBadge({ status, lastSavedAt }: { status: 'saved' | 'dirty' | 'saving'; lastSavedAt: string }) {
  // 与笔记/文集一致:saving→"保存中…"+呼吸点;其余(saved / dirty 等待期)→ 保持上次"已自动保存 hh:mm"
  //（dirty 期间不闪空,只有从没保存过时才为空）。不显示"未保存"。
  const savedText = lastSavedAt
    ? `已自动保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  return (
    <span className="mr-1 inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
      {status === 'saving' && (
        <span
          className="size-1.5 shrink-0 animate-pulse rounded-full [animation-duration:1.2s]"
          style={{ background: 'var(--accent)' }}
          aria-hidden
        />
      )}
      {status === 'saving' ? '保存中…' : savedText}
    </span>
  );
}

// ─── 页面主体 ───

export default function GalleryEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const {
    loading,
    title,
    prose,
    photos,
    date,
    location,
    saveStatus,
    lastSavedAt,
    updateTitle,
    reorderPhotos,
    updateCaption,
    updatePhotoTags,
    uploadPhotos,
    retryUpload,
    uploadProgress,
    deletePhoto,
    // setCover 暂无入口,后续可加 PhotoRowEditor 右键菜单
    updateDate,
    updateLocation,
    save,
    commit,
    clearLocalDraft,
  } = useGalleryEditor(id);

  const uploading = uploadProgress !== null;

  // 上传中阻止离开：beforeunload（刷新/关闭）+ popstate（浏览器后退）+ safeNavigate（返回按钮）
  useEffect(() => {
    if (!uploading) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 压入一条 history 条目，后退时触发 popstate 而不是真正离开
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      if (window.confirm('照片正在上传中，离开将中断上传。确认离开？')) {
        window.history.back();
      } else {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [uploading]);

  const safeNavigate = (to: string) => {
    if (uploading && !window.confirm('照片正在上传中，离开将中断上传。确认离开？')) return;
    navigate(to);
  };

  // 图说写手 Aurora 浮层:仅当 gallery-caption-writer agent 实际会用的 provider 配了视觉模型时才挂。
  // 2026-05-30 #5 重构后每个 agent 自选 provider,不能再问全局 activeProviderId(那一支会指着没视觉的 deepseek
  // 而 agent 早绑了配视觉的 zhipu)。解析顺序与后端 agent.service 一致:visionProviderId → providerId → activeProviderId。
  const [hasVision, setHasVision] = useState(false);
  useEffect(() => {
    void settingsApi
      .getConfig()
      .then((c) => {
        const agent = c.agent.configs.find((a) => a.key === 'gallery-caption-writer');
        const visionProviderId =
          agent?.visionProviderId || agent?.providerId || c.ai.activeProviderId;
        const provider = c.ai.providers.find((p) => p.id === visionProviderId);
        setHasVision(!!provider?.visionModel);
      })
      .catch(() => setHasVision(false));
  }, []);

  // 提交：Modal 输入变更说明 → Git commit → 跳回列表页
  const handleCommit = async (changeNote: string) => {
    await commit(changeNote);
    navigate(`/admin/gallery?post=${id}`);
  };

  // 丢弃草稿：确认 → 删草稿 → 回详情(与笔记/文集编辑器 ⋯ 菜单一致)
  const confirm = useConfirm();
  const handleDiscard = async () => {
    if (!id) return;
    const ok = await confirm({ title: '丢弃草稿', message: '确认丢弃当前草稿？', danger: true, confirmLabel: '丢弃' });
    if (!ok) return;
    await galleryApi.deleteDraft(id);
    clearLocalDraft(); // 已丢弃,清本地草稿缓存,防下次打开被当未同步草稿恢复
    navigate(`/admin/gallery?post=${id}`);
  };

  if (loading) {
    return <LoadingState variant="full" />;
  }

  return (
    // 与笔记/文集编辑器一样的心智:左侧内容区 + 右侧 Aurora 整列(自管顶栏)
    <div className="flex h-screen overflow-hidden">
      {/* 左侧:画廊内容区(顶栏 + 滚动内容) */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* 顶栏：扁平,与笔记/文集编辑器统一(返回图标 + 标题 + 保存/提交/主题切换)。
          散文工具栏已统一为浮动工具栏,不再 portal 到顶栏中央。 */}
      <header className="flex shrink-0 items-center justify-between px-4" style={{ height: 52 }}>
        {/* 左:返回 + 可编辑标题 */}
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
            style={{ color: 'var(--ink-faded)' }}
            onClick={() => safeNavigate(`/admin/gallery?post=${id}`)}
            aria-label="返回"
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <input
            type="text"
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="无标题"
            className="input-ghost min-w-[60px] max-w-[280px] truncate text-base font-medium placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)' }}
          />
        </div>

        {/* 右:保存状态 + 保存 + 提交 + 主题切换 */}
        <div className="flex items-center gap-1.5">
          <SaveStatusBadge status={saveStatus} lastSavedAt={lastSavedAt} />
          <Button variant="ghost" size="default" className="text-base" onClick={() => void save()} disabled={uploading}>
            保存
          </Button>
          {/* 提交就近浮层:以「提交」按钮为锚点弹出 */}
          <CommitPopover onSubmit={handleCommit}>
            <Button variant="secondary" size="default" className="text-base" disabled={uploading}>
              提交
            </Button>
          </CommitPopover>
          {/* 主题切换 — 编辑页独立路由(无 IconRail), 留在 toolbar 内 */}
          <button
            className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
            style={{ color: 'var(--ink-ghost)' }}
            onClick={() => setTheme(theme === 'daylight' ? 'midnight' : 'daylight')}
            aria-label="切换主题"
            title="切换主题"
          >
            <Sun size={18} strokeWidth={1.5} className="theme-icon-light" />
            <Moon size={18} strokeWidth={1.5} className="theme-icon-dark" />
          </button>
          {/* ⋯ 菜单:丢弃草稿(与笔记/文集编辑器一致) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none data-[state=open]:bg-[var(--shelf)]"
                style={{ color: 'var(--ink-ghost)' }}
                title="更多"
              >
                <MoreHorizontal size={18} strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => void handleDiscard()}
                className="text-[var(--danger)] focus:bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] [&_svg]:text-[var(--danger)]"
              >
                <Trash2 />丢弃草稿
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* 上传进度条 — 2px 细线贴在 topbar 底部 */}
      {uploading && (
        <div className="h-0.5 shrink-0" style={{ background: 'var(--separator)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${Math.round((uploadProgress.uploaded / uploadProgress.total) * 100)}%`,
              background: 'var(--accent)',
            }}
          />
        </div>
      )}

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[var(--layout-reading-max)] flex-col gap-5 px-10 py-6 max-[520px]:px-4">
          {/* 照片行式编辑器:缩略 + caption inline + 日期/EXIF popover + Lightbox 看大图 */}
          <PhotoRowEditor
            photos={photos}
            uploadProgress={uploadProgress}
            onReorder={reorderPhotos}
            onCaptionChange={updateCaption}
            onTagsChange={updatePhotoTags}
            onDelete={deletePhoto}
            onUpload={(files) => void uploadPhotos(files)}
            onRetry={(photoId) => void retryUpload(photoId)}
          />

          {/* 日期 + 地点 */}
          <MetadataFields
            date={date}
            location={location}
            onDateChange={updateDate}
            onLocationChange={updateLocation}
          />
          {/* 注:后端 prose 字段保留,Aurora 画廊 context 流要用;前端无编辑入口(产品克制:"画廊故事让图说话")。 */}
        </div>
      </div>
      </div>

      {/* 右侧:图说写手整列(配了视觉模型才挂),与笔记/文集共用 AdvisorSidebar */}
      {hasVision && id && (
        <aside
          className="shrink-0"
          style={{
            width: 'clamp(20rem, 26vw, 30rem)',
            borderLeft: '1px solid var(--separator)',
          }}
        >
          <AdvisorSidebar
            sessionKey={`gallery:${id}`}
            agentInstanceKey={`gallery:${id}`}
            agentKey="gallery-caption-writer"
            source="gallery-editor"
            context={{
              gallery: {
                contentItemId: id,
                title,
                prose,
                photos: photos.map((p, i) => ({
                  index: i,
                  fileName: p.fileName,
                  caption: p.caption,
                  tags: p.tags ?? {},
                })),
              },
            }}
            greeting="想聊聊这些照片，还是要我写图说？"
            renderToolCard={(part, chat) => {
              const p = part as {
                type?: string;
                state?: string;
                toolCallId?: string;
              };
              if (p?.type !== 'tool-propose_caption' || p.state !== 'output-available')
                return null;
              // 非 ok(invalid/not_found)的不在 captionProposals 里 → 回退默认 ToolCallCard
              const proposal = chat.captionProposals.find(
                (c) => c.callId === p.toolCallId,
              );
              if (!proposal) return null;
              // 对话后照片可能被增删:目标 fileName 不在当前集合 → 禁用应用,避免"已应用却没落"的误导
              const photo = photos.find((ph) => ph.fileName === proposal.fileName);
              // 已应用 = 数据派生(照片当前 caption 就是这条建议),刷新后/重提议后都自动正确
              const applied = !!photo && photo.caption === proposal.caption;
              return (
                <InlineCaptionCard
                  caption={proposal.caption}
                  reason={proposal.reason}
                  photoUrl={photo?.url}
                  available={!!photo}
                  applied={applied}
                  onApply={() => updateCaption(proposal.fileName, proposal.caption)}
                />
              );
            }}
          />
        </aside>
      )}
    </div>
  );
}
