import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, X, FolderOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { importApi, type AssetRef, type ParseResult } from '@/services/import';
import { parseError } from './helpers';

/**
 * ImportPreviewPage — 文件导入预览页
 *
 * 双栏布局：左侧渲染 markdown 预览，右侧显示文件信息和资源状态。
 * 用户可补传缺失资源（上传文件夹），确认后正式创建 content item。
 *
 * 数据流：
 *   1. NodeFormModal 解析 .md 文件 → 存 sessionStorage → 跳转至此页
 *   2. 此页从 sessionStorage 读取 ParseResult（避免重复请求）
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
  const [toc, setToc] = useState<{ level: number; text: string; id: string }[]>([]);
  const [activeToc, setActiveToc] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!parseId) {
      toast.info('导入会话无效');
      navigate('/admin/content');
      return;
    }
    const cached = sessionStorage.getItem(`import-${parseId}`);
    if (cached) {
      const parsed = JSON.parse(cached) as ParseResult;
      setData(parsed);
      setTitle(parsed.title);
      setAssets(parsed.assets);
    } else {
      toast.info('导入会话已过期，请重新上传');
      navigate('/admin/content');
    }
  }, [parseId, navigate]);

  // TOC：从渲染后的 DOM 提取标题
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
  }, [data]);

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
      toast.success('资源匹配完成');
    } catch (err) {
      toast.error(parseError(err, '资源匹配失败'));
    } finally {
      setResolving(false);
    }
  };

  const handleConfirm = async () => {
    if (!parseId) return;
    setConfirming(true);
    try {
      const result = await importApi.confirm(parseId, parentId, title);
      sessionStorage.removeItem(`import-${parseId}`);
      toast.success('导入成功');
      navigate(`/admin/edit/${result.contentItemId}`);
    } catch (err) {
      toast.error(parseError(err, '导入失败'));
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    if (parseId) sessionStorage.removeItem(`import-${parseId}`);
    navigate('/admin/content');
  };

  const missingCount = assets.filter((a) => a.status === 'missing').length;

  if (!data) return null;

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--paper)' }}>
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
          <span style={{ fontSize: 'var(--text-sm)' }}>返回</span>
        </button>
        <h1
          className="font-semibold"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-base)' }}
        >
          导入预览
        </h1>
      </header>

      {/* Body — 双栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：Markdown 预览 */}
        <main ref={contentRef} className="flex-[2] overflow-y-auto px-12 py-8">
          <MarkdownBody markdown={data.markdown} />
        </main>

        {/* 右侧：信息面板 */}
        <aside
          className="flex w-[320px] flex-col border-l"
          style={{ borderColor: 'var(--separator)', background: 'var(--sidebar-bg)' }}
        >
          <div className="flex-1 overflow-y-auto space-y-5 px-5 py-5">
            {/* 文件信息 + 标题可编辑 */}
            <section>
              <h3
                className="mb-2 font-semibold"
                style={{ color: 'var(--ink)', fontSize: 'var(--text-sm)' }}
              >
                文件信息
              </h3>
              <div className="space-y-2">
                <label className="flex flex-col gap-1">
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-ghost)' }}>标题</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-md border-none px-2.5 py-1.5 outline-none"
                    style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)' }}
                  />
                </label>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-ghost)' }}>格式：Markdown</p>
              </div>
            </section>

            {/* 大纲（限制最大高度 40%，内部滚动） */}
            {toc.length > 0 && (
              <section>
                <h3
                  className="mb-2 font-semibold"
                  style={{ color: 'var(--ink)', fontSize: 'var(--text-sm)' }}
                >
                  大纲
                </h3>
                <div className="overflow-y-auto" style={{ maxHeight: '40vh' }}>
                  {toc.map((item) => (
                    <motion.div
                      key={item.id}
                      className="cursor-pointer border-l-2 py-[5px] transition-all duration-200"
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: activeToc === item.id ? 'var(--ink)' : 'var(--ink-faded)',
                        fontWeight: activeToc === item.id ? 500 : 400,
                        borderColor: activeToc === item.id ? 'var(--pip-a)' : 'transparent',
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

            {/* 资源引用（移到下面） */}
            <section>
              <h3
                className="mb-2 font-semibold"
                style={{ color: 'var(--ink)', fontSize: 'var(--text-sm)' }}
              >
                资源引用
              </h3>
              {assets.length === 0 ? (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-ghost)' }}>
                  无外部资源引用
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {assets.map((asset) => (
                    <li
                      key={asset.ref}
                      className="flex items-center gap-2"
                      style={{ fontSize: 'var(--text-xs)' }}
                    >
                      {asset.status === 'resolved' ? (
                        <Check size={12} style={{ color: 'var(--mark-green)' }} />
                      ) : (
                        <X size={12} style={{ color: 'var(--mark-red)' }} />
                      )}
                      <span
                        className="truncate"
                        style={{ color: asset.status === 'resolved' ? 'var(--ink-faded)' : 'var(--mark-red)' }}
                      >
                        {asset.filename}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 补传区域：仅当存在缺失资源时显示 */}
            {missingCount > 0 && (
              <section>
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-expect-error webkitdirectory is non-standard but widely supported
                  webkitdirectory=""
                  multiple
                  className="hidden"
                  onChange={handleResolveAssets}
                />
                <button
                  onClick={() => folderInputRef.current?.click()}
                  disabled={resolving}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-medium transition-opacity disabled:opacity-50"
                  style={{
                    background: 'var(--shelf)',
                    color: 'var(--ink-faded)',
                    fontSize: 'var(--text-sm)',
                    border: '1px dashed var(--separator)',
                  }}
                >
                  <FolderOpen size={14} strokeWidth={1.5} />
                  {resolving ? '匹配中...' : '上传文件夹补全资源'}
                </button>
                <p
                  className="mt-1.5"
                  style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-ghost)' }}
                >
                  选择包含图片的文件夹，将按文件名自动匹配
                </p>
              </section>
            )}
          </div>

          {/* 底部操作 */}
          <div
            className="flex gap-2 border-t px-5 py-4"
            style={{ borderColor: 'var(--separator)' }}
          >
            <button
              onClick={handleCancel}
              className="flex-1 rounded-lg py-2.5 font-medium"
              style={{ background: 'var(--shelf)', color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="flex-1 rounded-lg py-2.5 font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 'var(--text-sm)' }}
            >
              {confirming ? '导入中...' : missingCount > 0 ? `确认导入 (${missingCount} 项缺失)` : '确认导入'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
