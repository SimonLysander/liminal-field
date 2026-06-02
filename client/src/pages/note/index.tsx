/*
 * NotePage — 笔记阅读端,URL query 决定渲染哪个子视图(详见 NotePage 注释)。
 *
 * Reading width: max-w-[var(--layout-reading-max)] + px-10(与编辑区阅读宽度一致)。
 * TOC / scroll spy / 滚动定位:共享组件 MarkdownTocPanel,逻辑见组件文档。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';
import { smoothBounce } from '@/lib/motion';
import { notesApi as contentItemsApi } from '@/services/workspace';
import type { ContentDetail } from '@/services/workspace';
import { structureApi } from '@/services/structure';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { MarkdownTocPanel, type TocEntry } from '@/components/shared/MarkdownTocPanel';
import { LoadingState } from '@/components/LoadingState';
import { EmptyState } from '@/components/shared/EmptyState';

/* ================================================================
 * 阅读端按 URL query 分发(与 Sidebar 同源:URL 是唯一真相):
 *   /note?node=<id>    → NoteReader   文章阅读器(叶子文档正文)
 *   /note?at=<id>      → FolderReader 主题着陆页(节点同质化:文件夹也有自己的正文)
 *   /note              → NoteListView 未选态邀请
 *
 * 节点同质化(2026-05-29):每个导航节点都有自己的 ContentItem,
 * 文件夹/主题节点也可能携带正文——进入文件夹时渲染其自身正文(若有),
 * 空正文则回退到邀请空态。node 优先于 at:同时存在时展示具体文档。
 * ================================================================ */

export default function NotePage() {
  const [searchParams] = useSearchParams();
  // noteId / topicId 是语义命名(叶子文档 id / 钻入主题 id),与 query key 命名解耦
  const noteId = searchParams.get('node');
  const topicId = searchParams.get('at');
  if (noteId) return <NoteReader id={noteId} />;
  if (topicId) return <FolderReader nodeId={topicId} />;
  return <NoteListView />;
}

/* ---------- Empty State ---------- */

function NoteListView() {
  // 阅读端主从布局右侧未选态:大留白区,用稍繁盛的"邀请"纸艺填充(非"待生长"空花圃)
  return (
    <EmptyState
      image="/garden/reading-invite.webp"
      title="选择一篇笔记开始阅读"
    />
  );
}

/* ---------- Folder / Topic Landing ---------- */

/**
 * FolderReader — 主题（文件夹节点）着陆页。
 *


 * 节点同质化后文件夹也有自己的 ContentItem，这里渲染其已发布正文
 * （取正文 → MarkdownBody 渲染 → 空正文不渲染）。展示端子项列表由 Sidebar
 * 抽屉下钻承载，故主面板只负责呈现主题自身正文。
 *
 * 数据流：topicId →（公开的 /structure-nodes/:id/path）取末节点拿 contentItemId
 *        → notesApi.getById（不传 visibility=all，仅取已发布正文）。
 * 任一步失败或正文为空 → 回退到 NoteListView 邀请空态，不打断阅读体验。
 */
function FolderReader({ nodeId }: { nodeId: string }) {
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        // path 末节点即当前主题节点本身，从中取其 ContentItem id
        const path = await structureApi.getPathByNodeId(nodeId);
        const self = path[path.length - 1];
        const contentItemId = self?.contentItemId;
        if (!contentItemId) {
          if (!cancelled) setContent(null);
          return;
        }
        // 不传 visibility=all：展示端只读已发布正文，未发布则后端 404，按空正文处理
        const data = await contentItemsApi.getById(contentItemId);
        if (!cancelled) setContent(data);
      } catch {
        // 主题无正文 / 未发布 / 加载失败：静默降级为空态，沿用既有邀请页
        if (!cancelled) setContent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  // 主题自身无正文（空 body 或无 ContentItem）→ 回退到既有未选态邀请
  if (!content || !content.bodyMarkdown) {
    return <NoteListView />;
  }

  const title = content.publishedVersion?.title ?? content.latestVersion.title ?? '';
  /* 元信息(reader 类「读完仪式感」三件套:更新于 + 字数 + 阅读时间);与 NoteReader 同规格 */
  const wordCount = content.bodyMarkdown.length || 0;
  const readMin = Math.max(1, Math.ceil(wordCount / 400));
  const displayDate = content.updatedAt
    ? new Date(content.updatedAt)
    : content.createdAt ? new Date(content.createdAt) : null;

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto py-12">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
          {/* 主题标题 — 与 NoteReader 一致的衬线大标题入场,mb-4 跟 NoteReader 对齐(原 mb-10 偏大) */}
          <motion.div
            className="relative mb-4 text-5xl font-bold leading-snug tracking-tight"
            style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, ease: smoothBounce }}
          >
            {title}
          </motion.div>

          {/* 元信息行(纯墨,§3.3 reader 主体一律纯墨;原 pip-a 雾蓝色条违规已删) */}
          <motion.p
            className="mb-10 text-xs"
            style={{ color: 'var(--ink-ghost)' }}
            initial={{ opacity: 0, filter: 'blur(3px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
          >
            {displayDate && `更新于 ${displayDate.getFullYear()}/${displayDate.getMonth() + 1}/${displayDate.getDate()} · `}
            {wordCount > 1000 ? `${(wordCount / 1000).toFixed(1)}k` : wordCount} 字 · {readMin} min
          </motion.p>

          {/* Markdown 正文 — 复用 NoteReader 同款 prose 容器与 MarkdownBody 渲染 */}
          <motion.div
            className="note-prose text-lg leading-[1.9]"
            style={{ color: 'var(--ink-light)' }}
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
          >
            <MarkdownBody markdown={content.bodyMarkdown} contentItemId={content.id} />
          </motion.div>

          {/* 章末收束 — 一束勿忘我(纸艺,§3.3 合规) */}
          <div className="flex items-center justify-center py-24">
            <img
              src="/garden/chapter-end.webp"
              alt=""
              className="h-auto w-auto max-h-[60px] select-none"
              draggable={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Article Reader ---------- */

function NoteReader({ id }: { id: string }) {
  const navigate = useNavigate();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const data = await contentItemsApi.getById(id);
        if (!cancelled) setContent(data);
      } catch {
        if (cancelled) return;
        banner.error('文章不存在');
        navigate('/note', { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  /*
   * TOC 从 API 返回的 headings 字段派生(无需 DOM 查询)。
   * id 格式 "heading-N" 与 MarkdownBody 注入的 data-heading-id 一致,
   * MarkdownTocPanel 内部的 scroll spy/scrollToHeading 据此查 DOM。
   */
  const toc = useMemo<TocEntry[]>(() => {
    if (!content?.headings) return [];
    return content.headings.map((h, i) => ({
      level: h.level,
      text: h.text,
      id: `heading-${i}`,
    }));
  }, [content]);

  /* 标题信息 */
  const title = content?.publishedVersion?.title ?? content?.latestVersion.title ?? '';
  const summary = content?.publishedVersion?.summary ?? '';
  const wordCount = content?.bodyMarkdown.length || 0;
  const readMin = Math.max(1, Math.ceil(wordCount / 400));

  /* 日期：统一用 updatedAt，兜底 createdAt */
  const displayDate = content?.updatedAt
    ? new Date(content.updatedAt)
    : content?.createdAt ? new Date(content.createdAt) : null;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">
      {/* Center — article body */}
      <div className="flex-1 overflow-y-auto py-12" ref={centerRef}>
       <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 返回入口已统一到左 Sidebar 面包屑,中区不再放重复的「← 返回」 */}

        {/* 文章标题 — fade+rise 入场 */}
        <motion.div
          className="relative mb-4 text-5xl font-bold leading-snug tracking-tight"
          style={{
            fontFamily: 'var(--font-serif)',
            color: 'var(--ink)',
          }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {title}
        </motion.div>

        {/* 元信息行(纯墨,跟 §3.3「reader 主体一律纯墨」对齐;原 pip-a 雾蓝色条违规已删) */}
        <motion.p
          className="mb-10 text-xs"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
        >
          {displayDate && `更新于 ${displayDate.getFullYear()}/${displayDate.getMonth() + 1}/${displayDate.getDate()} · `}
          {wordCount > 1000 ? `${(wordCount / 1000).toFixed(1)}k` : wordCount} 字 · {readMin} min
        </motion.p>

        {summary && (
          /* 题记块:shelf 背景已承担"题记"视觉强调,不再叠 italic(中文字体 italic 抖动且语气过重) */
          <motion.div
            className="mb-8 rounded-lg px-4 py-3 text-lg leading-relaxed"
            style={{ color: 'var(--ink-faded)', background: 'var(--shelf)' }}
            initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.4, delay: 0.15, ease: smoothBounce }}
          >
            {summary}
          </motion.div>
        )}

        {/* Markdown 正文 — 延迟浮入 */}
        <motion.div
          className="note-prose text-lg leading-[1.9]"
          style={{ color: 'var(--ink-light)' }}
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
        >
          <MarkdownBody markdown={content.bodyMarkdown} contentItemId={id} />
        </motion.div>

        {/* 章末收束 — 一束勿忘我(纸艺,§3.3 合规;花语「记忆」) */}
        <div className="flex items-center justify-center py-24">
          <img
            src="/garden/chapter-end.webp"
            alt=""
            className="h-auto w-auto max-h-[60px] select-none"
            draggable={false}
          />
        </div>
       </div>
      </div>

      {/* Right — TOC panel(共享组件,容器始终预留宽度避免布局抖动) */}
      <MarkdownTocPanel toc={toc} centerRef={centerRef} />
    </div>
  );
}

