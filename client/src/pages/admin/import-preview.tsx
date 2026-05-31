import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, X, FolderOpen, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { importApi, type AssetRef, type ParseResult } from '@/services/import';
import { useSessionCountdown, clearSessionStart } from './hooks/useSessionCountdown';
import { parseError } from './helpers';

/**
 * ImportPreviewPage — 文件导入预览页
 *
 * 双栏布局：左侧渲染 markdown 预览，右侧显示文件信息和资源状态。
 * 用户可补传缺失资源（上传文件夹），确认后正式创建 content item。
 *
 * 数据流：
 *   1. NodeFormModal 解析文件 → 跳转至此页（带 parseId）
 *   2. 此页通过 GET API 从后端加载 ParseResult（MongoDB + MinIO）
 *   3. 用户可上传文件夹补全缺失图片资源
 *   4. 确认后调用 confirm API，跳转到编辑页
 */
export default function ImportPreviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parseId = searchParams.get('parseId');
  const parentId = searchParams.get('parentId') ?? undefined;

  const [data, setData] = useState<ParseResult | null>(null);
  const [title, setTitle] = useState('');
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [resolving, setResolving] = useState(false);
  const countdown = useSessionCountdown();
  const [toc, setToc] = useState<{ level: number; text: string; id: string }[]>([]);
  const [activeToc, setActiveToc] = useState('');
  /** PlateReadOnly 异步就绪后才打上 data-heading-id，用计数触发 TOC 重新收集 */
  const [plateLayoutGen, setPlateLayoutGen] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const tocContainerRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!parseId) {
      banner.info('导入会话无效');
      navigate('/admin/notes');
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    importApi.getParse(parseId)
      .then((parsed) => {
        setData(parsed);
        setTitle(parsed.title);
        setAssets(parsed.assets);
      })
      .catch((err) => {
        console.error('[ImportPreview] 加载导入会话失败:', err);
        // 导入会话加载失败（通常为过期），提示用户重试
          banner.info('导入会话已过期，请重新上传');
        navigate('/admin/notes');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [parseId, navigate]);

  // TOC：从渲染后的 DOM 提取标题（依赖 plateLayoutGen：Plate 异步解析后再跑一遍）
  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container || !data) { setToc([]); return; }
    const els = container.querySelectorAll<HTMLElement>('[data-heading-id]');
    const entries: { level: number; text: string; id: string }[] = [];
    els.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const level = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3;
      entries.push({ level, text: el.textContent || '', id: el.getAttribute('data-heading-id') || '' });
    });
    setToc(entries);
  }, [data, plateLayoutGen]);

  // Scroll spy：追踪当前阅读位置
  const handleScroll = useCallback(() => {
    const container = contentRef.current;
    if (!container || toc.length === 0) return;
    const threshold = container.getBoundingClientRect().top + 50;
    const headingEls = container.querySelectorAll('[data-heading-id]');
    for (let i = headingEls.length - 1; i >= 0; i--) {
      const el = headingEls[i] as HTMLElement;
      if (el.getBoundingClientRect().top <= threshold) {
        setActiveToc(el.getAttribute('data-heading-id') || '');
        return;
      }
    }
    if (toc[0]) setActiveToc(toc[0].id);
  }, [toc]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // TOC active 项变化时，自动滚到可见位置
  useEffect(() => {
    if (!activeToc || !tocContainerRef.current) return;
    const activeEl = tocContainerRef.current.querySelector(`[data-toc-id="${activeToc}"]`);
    activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeToc]);

  const scrollToHeading = (headingId: string) => {
    const el = contentRef.current?.querySelector(`[data-heading-id="${headingId}"]`) as HTMLElement | null;
    if (!el || !contentRef.current) return;
    const top = el.getBoundingClientRect().top - contentRef.current.getBoundingClientRect().top + contentRef.current.scrollTop - 16;
    contentRef.current.scrollTo({ top, behavior: 'smooth' });
  };

  const handleResolveAssets = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !parseId) return;

    setResolving(true);
    try {
      const updated = await importApi.resolveAssets(parseId, files);
      setAssets(updated);
      // 资源匹配完成（资源状态列表更新即为反馈）
    } catch (err) {
      banner.error(parseError(err, '资源匹配失败'));
    } finally {
      setResolving(false);
    }
  };

  const handleConfirm = async () => {
    if (!parseId) return;
    setConfirming(true);
    try {
      const result = await importApi.confirm(parseId, parentId, title);
      // 导入成功后跳转到管理预览页（跳转即为成功反馈）
      const params = new URLSearchParams();
      if (parentId) params.set('at', parentId);
      params.set('node', result.contentItemId);
      navigate(`/admin/notes?${params.toString()}`);
    } catch (err) {
      banner.error(parseError(err, '导入失败'));
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    clearSessionStart();
    if (parseId) importApi.cancelParse(parseId).catch(() => {});
    const backUrl = parentId ? `/admin/notes?at=${parentId}` : '/admin/notes';
    navigate(backUrl);
  };

  const missingCount = assets.filter((a) => a.status === 'missing').length;

  function getConfirmLabel(): string {
    if (confirming) return '导入中...';
    if (missingCount > 0) return `确认导入 (${missingCount} 项缺失)`;
    return '确认导入';
  }

  if (loading || !data) return <ThresholdOverlay visible label="正在加载预览..." />;

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--paper)' }}>
      <ThresholdOverlay visible={confirming} label="正在导入内容..." />

      {/* Header */}
      <header
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: 'var(--separator)' }}
      >
        <button
          onClick={handleCancel}
          className="flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:opacity-70"
          style={{ color: 'var(--ink-faded)' }}
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          <span className="text-sm">返回</span>
        </button>
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          导入预览
        </h1>
        <span
          className="text-2xs tabular-nums"
          style={{ color: countdown.urgent ? 'var(--mark-red)' : 'var(--ink-ghost)' }}
        >
          {countdown.expired ? '会话已过期' : countdown.display}
        </span>
      </header>

      {/* Body — 双栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：Markdown 预览 */}
        <main
          ref={contentRef}
          className="min-w-0 flex-[2] overflow-y-auto px-12 py-8 max-[520px]:px-5"
        >
          <MarkdownBody
            markdown={data.markdown}
            onHeadingsMarked={() => setPlateLayoutGen((n) => n + 1)}
          />
        </main>

        {/* 右侧：信息面板 */}
        <aside
          className="flex shrink-0 flex-col border-l"
          style={{
            width: 'var(--layout-wide-aside)',
            borderColor: 'var(--separator)',
            background: 'var(--sidebar-bg)',
          }}
        >
          <div className="flex-1 overflow-y-auto space-y-5 px-5 py-5">
            {/* 文件信息 + 标题可编辑 */}
            <section>
              <h3
                className="mb-2 text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                文件信息
              </h3>
              <div className="space-y-2">
                <label className="flex flex-col gap-1">
                  <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>标题</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-md border-none px-2.5 py-1.5 text-sm outline-none"
                    style={{ background: 'var(--shelf)', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}
                  />
                </label>
                <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>格式：Markdown</p>
              </div>
            </section>

            {/* 大纲（限制最大高度 40%，内部滚动） */}
            {toc.length > 0 && (
              <section>
                <h3
                  className="mb-2 text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  大纲
                </h3>
                <div ref={tocContainerRef} className="overflow-y-auto" style={{ maxHeight: '40vh' }}>
                  {toc.map((item) => (
                    <motion.div
                      key={item.id}
                      data-toc-id={item.id}
                      className="cursor-pointer border-l-2 py-[5px] text-xs transition-all duration-200"
                      style={{
                        color: activeToc === item.id ? 'var(--ink-light)' : 'var(--ink-faded)',
                        fontWeight: activeToc === item.id ? 500 : 400,
                        borderColor: activeToc === item.id ? 'var(--ink-light)' : 'transparent',
                        paddingLeft: `${(item.level - 1) * 8 + 10}px`,
                      }}
                      animate={{ paddingLeft: activeToc === item.id ? (item.level - 1) * 8 + 12 : (item.level - 1) * 8 + 10 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      onClick={() => scrollToHeading(item.id)}
                    >
                      {item.text}
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* 资源引用：统计摘要 + 可展开详情 */}
            {assets.length > 0 && (
              <AssetSummary
                assets={assets}
                missingCount={missingCount}
                resolving={resolving}
                folderInputRef={folderInputRef}
                onResolve={handleResolveAssets}
              />
            )}
          </div>

          {/* 底部操作 */}
          <div
            className="flex gap-2 border-t px-5 py-4"
            style={{ borderColor: 'var(--separator)' }}
          >
            <button
              onClick={handleCancel}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium"
              style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming || countdown.expired}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
            >
              {getConfirmLabel()}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** 资源引用摘要组件：已加载/未加载统计 + 展开详情 + 补传入口 */
function AssetSummary({
  assets,
  missingCount,
  resolving,
  folderInputRef,
  onResolve,
}: {
  assets: AssetRef[];
  missingCount: number;
  resolving: boolean;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  onResolve: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolvedCount = assets.length - missingCount;

  return (
    <section>
      <h3
        className="mb-2 text-sm font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        资源引用
      </h3>

      {/* 统计摘要 */}
      <div className="flex items-center gap-3 text-xs">
        <span style={{ color: 'var(--ink-faded)' }}>
          <span style={{ color: 'var(--mark-green)' }}>{resolvedCount}</span> 已加载
          {missingCount > 0 && (
            <> · <span style={{ color: 'var(--mark-red)' }}>{missingCount}</span> 未加载</>
          )}
          <span style={{ color: 'var(--ink-ghost)' }}> / {assets.length} 总计</span>
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 text-2xs transition-colors hover:opacity-70"
          style={{ color: 'var(--ink-ghost)' }}
        >
          详情
          <ChevronDown
            size={10}
            strokeWidth={2}
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
          />
        </button>
      </div>

      {/* 展开的详情列表 */}
      {expanded && (
        <ul className="mt-2 max-h-[20vh] space-y-1 overflow-y-auto">
          {assets.map((asset) => (
            <li
              key={asset.ref}
              className="flex items-center gap-2 text-2xs"
            >
              {asset.status === 'resolved' ? (
                <Check size={10} style={{ color: 'var(--mark-green)' }} />
              ) : (
                <X size={10} style={{ color: 'var(--mark-red)' }} />
              )}
              <span
                className="truncate"
                style={{ color: asset.status === 'resolved' ? 'var(--ink-ghost)' : 'var(--mark-red)' }}
              >
                {asset.filename}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 补传入口 */}
      {missingCount > 0 && (
        <div className="mt-2">
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={onResolve}
          />
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={resolving}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-opacity disabled:opacity-50"
            style={{
              background: 'var(--shelf)',
              color: 'var(--ink-faded)',
              border: '1px dashed var(--separator)',
            }}
          >
            <FolderOpen size={12} strokeWidth={1.5} />
            {resolving ? '匹配中...' : '补全缺失资源'}
          </button>
        </div>
      )}
    </section>
  );
}
