/*
 * BatchImportPage — 文件夹批量导入预览页。
 *
 * Apple HIG 设计原则：
 * - "Show the screen immediately" — 立即渲染文件树骨架（纯客户端数据）
 * - "Favor progress bars" — header 确定性进度条显示解析进度
 * - "Replace placeholders as content loads" — 解析完成后更新 ⚠ 标记
 *
 * 两阶段：
 *   Phase 1: 从 navigation state 读取 FileList → 构建本地树 → 渲染骨架
 *   Phase 2: 后台调 batch-parse API → 进度条推进 → 就绪后可确认
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, FolderOpen, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { smoothBounce } from '@/lib/motion';
import JSZip from 'jszip';
import { importApi } from '@/services/import';
import type { BatchParsedItem } from '@/services/import';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { useSessionCountdown, markSessionStart, clearSessionStart } from './hooks/useSessionCountdown';
import { getPendingImportFiles, clearPendingImportFiles } from './batch-import-store';

/* ---- 本地文件条目（解析前） ---- */
interface LocalFileEntry {
  relativePath: string;
  name: string;
  file: File;
}

/* ---- 文件树节点 ---- */
interface TreeFolder {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

interface TreeFile {
  type: 'file';
  name: string;
  path: string;
  /** 解析前为 null，解析后填充 */
  parsed: BatchParsedItem | null;
}

type TreeNode = TreeFolder | TreeFile;

/** 从 relativePaths 构建树（解析前只有路径，parsed = null） */
function buildTreeFromPaths(entries: Array<{ relativePath: string; parsed: BatchParsedItem | null }>): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeFolder>();

  function ensureFolder(dirPath: string): TreeFolder {
    if (folderMap.has(dirPath)) return folderMap.get(dirPath)!;
    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];
    const folder: TreeFolder = { type: 'folder', name, path: dirPath, children: [] };
    folderMap.set(dirPath, folder);
    if (parts.length === 1) {
      root.push(folder);
    } else {
      const parent = ensureFolder(parts.slice(0, -1).join('/'));
      parent.children.push(folder);
    }
    return folder;
  }

  for (const entry of entries) {
    const parts = entry.relativePath.split('/');
    const file: TreeFile = {
      type: 'file',
      name: parts[parts.length - 1],
      path: entry.relativePath,
      parsed: entry.parsed,
    };
    if (parts.length === 1) {
      root.push(file);
    } else {
      const parent = ensureFolder(parts.slice(0, -1).join('/'));
      parent.children.push(file);
    }
  }

  return root;
}


/* ---- Tree Node Component ---- */
function TreeNodeView({
  node, depth, selected, checked, onSelect, onToggle,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  checked: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const paddingLeft = 12 + depth * 16;

  if (node.type === 'folder') {
    return (
      <>
        <div className="flex items-center gap-2 py-1.5 text-xs" style={{ paddingLeft, color: 'var(--ink-faded)' }}>
          <FolderOpen size={14} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
          <span className="font-medium">{node.name}/</span>
        </div>
        {node.children.map((child) => (
          <TreeNodeView key={child.path} node={child} depth={depth + 1} selected={selected} checked={checked} onSelect={onSelect} onToggle={onToggle} />
        ))}
      </>
    );
  }

  const isChecked = checked.has(node.path);
  const isSelected = selected === node.path;
  const isParsing = !node.parsed;
  const hasMissing = node.parsed ? node.parsed.missingAssets.length > 0 : false;

  return (
    <div
      className="flex items-center gap-2 py-1.5 rounded-md cursor-pointer transition-colors"
      style={{ paddingLeft, paddingRight: 8, background: isSelected ? 'var(--accent-soft)' : undefined }}
      onClick={() => onSelect(node.path)}
    >
      <button
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors"
        style={{
          borderColor: isChecked ? 'var(--accent)' : 'var(--ink-ghost)',
          background: isChecked ? 'var(--accent)' : 'transparent',
        }}
        onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
      >
        {isChecked && <Check size={10} strokeWidth={2.5} style={{ color: 'var(--accent-contrast)' }} />}
      </button>
      <FileText size={14} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
      <span className="text-xs truncate flex-1" style={{ color: isParsing ? 'var(--ink-ghost)' : 'var(--ink)' }}>
        {node.name}
      </span>
      {isParsing && (
        <span className="text-2xs shrink-0" style={{ color: 'var(--ink-ghost)' }}>…</span>
      )}
      {hasMissing && (
        <span className="text-2xs shrink-0" style={{ color: 'var(--mark-red)' }}>
          ⚠{node.parsed!.missingAssets.length}
        </span>
      )}
    </div>
  );
}

/* ---- Main Page ---- */
export default function BatchImportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get('parentId') ?? '';
  const parentName = searchParams.get('parentName') ?? '';

  // 从模块 store 获取文件数组（FolderOverviewPanel 选择文件夹后存入，Array.from 复制避免 input 重置后引用失效）
  const [incomingFiles] = useState<File[] | null>(() => getPendingImportFiles());

  // Phase 1: 从 FileList 提取 .md 条目（纯客户端同步计算，用 useMemo 而非 useEffect）
  const initialEntries = useMemo<LocalFileEntry[]>(() => {
    if (!incomingFiles || incomingFiles.length === 0) return [];
    const entries: LocalFileEntry[] = [];
    for (let i = 0; i < incomingFiles.length; i++) {
      const f = incomingFiles[i];
      if (f.webkitRelativePath.endsWith('.md')) {
        const parts = f.webkitRelativePath.split('/');
        const relativePath = parts.slice(1).join('/');
        entries.push({ relativePath, name: parts[parts.length - 1], file: f });
      }
    }
    return entries;
  }, [incomingFiles]);

  // 本地文件条目（可被恢复逻辑覆盖）
  const [localEntries, setLocalEntries] = useState<LocalFileEntry[]>(initialEntries);
  // 解析结果（Phase 2，逐步填充）
  const [parsedMap, setParsedMap] = useState<Map<string, BatchParsedItem>>(new Map());
  // 上传+解析进度
  const [parseProgress, setParseProgress] = useState({ done: 0, total: initialEntries.length });
  const [parseComplete, setParseComplete] = useState(false);
  // batchId（parse 完成后获得）
  const [batchId, setBatchId] = useState('');

  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialEntries.map((e) => e.relativePath)));
  const [selectedPath, setSelectedPath] = useState<string | null>(() => initialEntries[0]?.relativePath ?? null);
  const [previewMarkdown, setPreviewMarkdown] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const countdown = useSessionCountdown();

  // 会话过期时 toast 提醒（只触发一次）
  useEffect(() => {
    if (countdown.expired && parseComplete) {
      toast.error('导入会话已过期，请重新上传文件夹');
    }
  }, [countdown.expired, parseComplete]);

  // Phase 2: JSZip 打包文件夹 → 上传到服务端（资源匹配由后端完成）
  useEffect(() => {
    if (!incomingFiles || initialEntries.length === 0 || parseComplete) return;

    const run = async () => {
      const rootPrefix = incomingFiles[0].webkitRelativePath.split('/')[0];
      const zip = new JSZip();

      // 把所有文件加入 zip，保留相对路径（去掉根文件夹名）
      for (let i = 0; i < incomingFiles.length; i++) {
        const f = incomingFiles[i];
        const relPath = f.webkitRelativePath.startsWith(rootPrefix + '/')
          ? f.webkitRelativePath.slice(rootPrefix.length + 1)
          : f.webkitRelativePath;
        // 跳过 .DS_Store 等隐藏文件
        if (relPath.startsWith('.') || relPath.includes('/.')) continue;
        zip.file(relPath, f);

        // 更新进度（打包阶段占 40%）
        if (i % 20 === 0) {
          setParseProgress({
            done: Math.round((i / incomingFiles.length) * 0.4 * initialEntries.length),
            total: initialEntries.length,
          });
        }
      }

      // 生成 zip blob
      setParseProgress({ done: Math.round(0.4 * initialEntries.length), total: initialEntries.length });
      const blob = await zip.generateAsync({ type: 'blob' });

      // 上传（占剩余 60%）
      const formData = new FormData();
      formData.append('parentId', parentId);
      formData.append('archive', blob, 'import.zip');

      setParseProgress({ done: Math.round(0.5 * initialEntries.length), total: initialEntries.length });

      try {
        const result = await importApi.batchParse(formData);
        setBatchId(result.batchId);

        const map = new Map<string, BatchParsedItem>();
        for (const item of result.items) map.set(item.relativePath, item);
        setParsedMap(map);
        setParseProgress({ done: initialEntries.length, total: initialEntries.length });
        setParseComplete(true);

        sessionStorage.setItem(`batch-import-${result.batchId}`, JSON.stringify(result.items));
        markSessionStart();

        // 将 batchId 写入 URL，刷新后可从 sessionStorage 恢复
        const url = new URL(window.location.href);
        url.searchParams.set('batchId', result.batchId);
        window.history.replaceState(null, '', url.toString());
      } catch (err) {
        toast.error(`解析失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void run();
     
  }, [incomingFiles, initialEntries, parentId, parseComplete]);

  // 恢复已有会话（刷新或从 URL 进入）— 仅处理 API 恢复，sessionStorage 恢复在 state 初始化中完成
  const urlBatchId = searchParams.get('batchId');
  const restoredFromStorage = useMemo(() => {
    if (!urlBatchId || incomingFiles) return null;
    const stored = sessionStorage.getItem(`batch-import-${urlBatchId}`);
    if (!stored) return null;
    return JSON.parse(stored) as BatchParsedItem[];
  }, [urlBatchId, incomingFiles]);

  // sessionStorage 恢复：通过 useEffect 设置（仅首次运行）
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored || !restoredFromStorage) return;
    const data = restoredFromStorage;
    const entries = data.map((d) => ({
      relativePath: d.relativePath,
      name: d.relativePath.split('/').pop() ?? d.relativePath,
      file: null as unknown as File,
    }));
    const map = new Map<string, BatchParsedItem>();
    for (const item of data) map.set(item.relativePath, item);
    // 从 sessionStorage 恢复初始状态（一次性水合，非派生状态）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部数据源水合
    setLocalEntries(entries);
    setParsedMap(map);
    setChecked(new Set(data.map((d) => d.relativePath)));
    setSelectedPath(data[0]?.relativePath ?? null);
    setBatchId(urlBatchId!);
    setParseComplete(true);
    setParseProgress({ done: data.length, total: data.length });
    setRestored(true);
  }, [restoredFromStorage, restored, urlBatchId]);

  // API 恢复（sessionStorage 没有时从服务端获取）
  useEffect(() => {
    if (!urlBatchId || incomingFiles || restoredFromStorage) return;
    importApi.getBatch(urlBatchId).then((session) => {
      const entries = session.items.map((i) => ({
        relativePath: i.relativePath,
        name: i.relativePath.split('/').pop() ?? i.relativePath,
        file: null as unknown as File,
      }));
      const map = new Map<string, BatchParsedItem>();
      for (const item of session.items) {
        map.set(item.relativePath, { ...item, missingAssets: [] });
      }
      setLocalEntries(entries);
      setParsedMap(map);
      setChecked(new Set(session.items.map((i) => i.relativePath)));
      setSelectedPath(session.items[0]?.relativePath ?? null);
      setBatchId(urlBatchId);
      setParseComplete(true);
      setParseProgress({ done: session.items.length, total: session.items.length });
    }).catch(() => {
      // 会话已不存在（已完成/已过期），静默跳回
      navigate(`/admin/notes?topic=${parentId}`, { replace: true });
    });
  }, [urlBatchId, incomingFiles, restoredFromStorage, navigate, parentId]);

  // 加载选中文件的预览（crossfade 由 AnimatePresence 处理）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 预览清空是副作用清理
    if (!selectedPath) { setPreviewMarkdown(''); return; }
    const parsed = parsedMap.get(selectedPath);
    if (!parsed) {
      // 解析中，尝试从本地文件直接读取原始 markdown
      const entry = localEntries.find((e) => e.relativePath === selectedPath);
      if (entry?.file) {
        entry.file.text().then(setPreviewMarkdown).catch(() => setPreviewMarkdown(''));
      } else {
        setPreviewMarkdown('');
      }
      return;
    }
    setPreviewLoading(true);
    importApi.getParse(parsed.parseId).then((result) => {
      setPreviewMarkdown(result.markdown);
    }).catch(() => {
      setPreviewMarkdown('_预览加载失败_');
    }).finally(() => setPreviewLoading(false));
  }, [selectedPath, parsedMap, localEntries]);

  // 树结构
  const treeEntries = useMemo(
    () => localEntries.map((e) => ({ relativePath: e.relativePath, parsed: parsedMap.get(e.relativePath) ?? null })),
    [localEntries, parsedMap],
  );
  const tree = useMemo(() => buildTreeFromPaths(treeEntries), [treeEntries]);

  const handleToggle = useCallback((path: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const folderCount = useMemo(() => {
    const dirs = new Set<string>();
    for (const e of localEntries) {
      const parts = e.relativePath.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return dirs.size;
  }, [localEntries]);

  const totalMissing = useMemo(
    () => [...parsedMap.values()].reduce((sum, i) => sum + i.missingAssets.length, 0),
    [parsedMap],
  );

  const resolveInputRef = useRef<HTMLInputElement>(null);
  const [resolving, setResolving] = useState(false);

  const handleResolveAssets = useCallback(
    async (files: FileList) => {
      if (files.length === 0) return;
      setResolving(true);
      const fileByName = new Map<string, File>();
      for (let i = 0; i < files.length; i++) fileByName.set(files[i].name.toLowerCase(), files[i]);

      const newMap = new Map(parsedMap);
      for (const [path, item] of newMap) {
        if (item.missingAssets.length === 0) continue;
        const matched: File[] = [];
        for (const name of item.missingAssets) {
          const f = fileByName.get(name.toLowerCase());
          if (f) matched.push(f);
        }
        if (matched.length === 0) continue;
        try {
          const dt = new DataTransfer();
          for (const f of matched) dt.items.add(f);
          const result = await importApi.resolveAssets(item.parseId, dt.files);
          const resolved = new Set(result.filter((a) => a.status === 'resolved').map((a) => a.filename.toLowerCase()));
          newMap.set(path, { ...item, missingAssets: item.missingAssets.filter((n) => !resolved.has(n.toLowerCase())) });
        } catch { /* skip */ }
      }
      setParsedMap(newMap);
      setResolving(false);
      const remaining = [...newMap.values()].reduce((s, i) => s + i.missingAssets.length, 0);
      toast[remaining === 0 ? 'success' : 'info'](remaining === 0 ? '所有缺失资源已补全' : `仍有 ${remaining} 个缺失`);
    },
    [parsedMap],
  );

  // 导入进度（确认后轮询）
  const [importProgress, setImportProgress] = useState<{ completed: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 组件卸载时清理轮询，防止内存泄漏和 unmounted setState
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleConfirm = useCallback(async () => {
    if (checked.size === 0 || !batchId) return;
    setConfirming(true);
    try {
      const result = await importApi.batchConfirm({ batchId, parentId, selectedPaths: [...checked] });
      clearPendingImportFiles();
      clearSessionStart();
      sessionStorage.removeItem(`batch-import-${batchId}`);

      // 开始轮询后台进度
      setImportProgress({ completed: 0, total: result.docsCreated });
      const jobId = result.jobId;
      pollRef.current = setInterval(async () => {
        try {
          const progress = await importApi.getBatchJobProgress(jobId);
          setImportProgress({ completed: progress.completed, total: progress.total });
          if (progress.status === 'done') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            toast.success(`导入完成：${result.foldersCreated} 个文件夹，${progress.completed} 篇文档`);
            navigate(`/admin/notes?topic=${parentId}`, { replace: true });
          } else if (progress.status === 'failed') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            toast.error('部分文档导入失败');
            navigate(`/admin/notes?topic=${parentId}`, { replace: true });
          }
        } catch {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          navigate(`/admin/notes?topic=${parentId}`, { replace: true });
        }
      }, 800);
    } catch (err) {
      toast.error(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
      setConfirming(false);
    }
  }, [batchId, parentId, checked, navigate]);

  const handleCancel = useCallback(async () => {
    clearPendingImportFiles();
    clearSessionStart();
    if (batchId) await importApi.cancelBatch(batchId).catch(() => {});
    sessionStorage.removeItem(`batch-import-${batchId}`);
    navigate(`/admin/notes?topic=${parentId}`, { replace: true });
  }, [batchId, parentId, navigate]);

  // 进度条百分比
  const progressPercent = parseProgress.total > 0
    ? Math.round((parseProgress.done / parseProgress.total) * 100)
    : 0;

  function getConfirmLabel(): string {
    if (importProgress) return `导入中 ${importProgress.completed}/${importProgress.total}`;
    if (confirming) return '提交中…';
    if (!parseComplete) return `解析中 ${progressPercent}%`;
    return `导入 ${checked.size} 篇`;
  }

  // 导入阶段的进度百分比
  const importPercent = importProgress
    ? Math.round((importProgress.completed / Math.max(importProgress.total, 1)) * 100)
    : 0;

  // 空状态（无 files 且无 URL batchId）
  if (localEntries.length === 0 && !searchParams.get('batchId')) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: 'var(--paper)' }}>
        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>无文件可导入</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--paper)' }}>
      {/* Header */}
      <header className="shrink-0" style={{ borderBottom: '0.5px solid var(--separator)' }}>
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1 text-xs" style={{ color: 'var(--ink-faded)' }} onClick={handleCancel}>
              <ArrowLeft size={14} strokeWidth={1.5} />
              返回
            </button>
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              导入文件夹{parentName ? ` → 「${parentName}」` : ''}
            </span>
            {parseComplete && (
              <span className="text-2xs tabular-nums" style={{ color: countdown.urgent ? 'var(--mark-red)' : 'var(--ink-ghost)' }}>
                {countdown.expired ? '会话已过期' : countdown.display}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }} onClick={handleCancel}>
              取消
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
              disabled={!parseComplete || checked.size === 0 || confirming || countdown.expired}
              onClick={handleConfirm}
            >
              {getConfirmLabel()}
            </button>
          </div>
        </div>

        {/* 确定性进度条：解析阶段 或 导入阶段 */}
        {(!parseComplete || importProgress) && (
          <div className="h-0.5 w-full" style={{ background: 'var(--separator)' }}>
            <motion.div
              className="h-full"
              style={{ background: importProgress ? 'var(--mark-green)' : 'var(--accent)' }}
              initial={{ width: '0%' }}
              animate={{ width: `${importProgress ? importPercent : progressPercent}%` }}
              transition={{ duration: 0.3, ease: smoothBounce }}
            />
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: file tree */}
        <aside className="shrink-0 flex flex-col overflow-hidden" style={{ width: 260, background: 'var(--sidebar-bg)', borderRight: '0.5px solid var(--separator)' }}>
          <div className="flex-1 overflow-y-auto py-3 px-2">
            {tree.map((node) => (
              <TreeNodeView key={node.path} node={node} depth={0} selected={selectedPath} checked={checked} onSelect={setSelectedPath} onToggle={handleToggle} />
            ))}
          </div>

          {/* Summary + 补全 */}
          <div className="shrink-0 px-4 py-3 space-y-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
            <div className="text-xs" style={{ color: 'var(--ink-faded)' }}>
              {folderCount > 0 && `${folderCount} 个主题 · `}{localEntries.length} 篇文档
            </div>
            {parseComplete && totalMissing > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--mark-red)' }}>{totalMissing} 个资源缺失</span>
                <button
                  className="text-xs font-medium rounded px-2 py-0.5 disabled:opacity-50"
                  style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
                  disabled={resolving}
                  onClick={() => resolveInputRef.current?.click()}
                >
                  {resolving ? '匹配中…' : '补全'}
                </button>
              </div>
            )}
          </div>

          <input
            ref={resolveInputRef}
            type="file"
            className="hidden"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitdirectory 非标准属性
            {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
            onChange={(e) => { if (e.target.files) void handleResolveAssets(e.target.files); e.target.value = ''; }}
          />
        </aside>

        {/* Right: preview with crossfade */}
        <main className="flex-1 overflow-y-auto px-10 py-8">
          <div className="mx-auto w-full max-w-[var(--layout-reading-max)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedPath ?? 'empty'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {previewLoading ? (
                  <p className="text-sm py-20 text-center" style={{ color: 'var(--ink-ghost)' }}>加载预览…</p>
                ) : previewMarkdown ? (
                  <MarkdownBody markdown={previewMarkdown} />
                ) : (
                  <p className="text-sm py-20 text-center" style={{ color: 'var(--ink-ghost)' }}>
                    {localEntries.length > 0 ? '选择左侧文件预览内容' : ''}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
