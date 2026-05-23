/**
 * useLocalDraftBuffer — local-first 草稿本地缓冲。
 *
 * 目标:写作工具"一个字都不丢"。每次改动即时同步写 localStorage(零延迟),服务器草稿仍按
 * 1.5s 防抖同步。崩溃/刷新/关页时本地已落盘 → 重开时若本地还有"没同步上去的内容"则恢复。
 *
 * 设计要点(为何这版可靠):
 * - **本地缓存的存在本身 = 有未同步的改动**。一旦成功同步到服务器,立刻 clear() 清空。
 *   所以正常刷新(都同步过)时本地缓存是空的,reconcile 不会误判、不会重存,时间戳保持真实。
 * - 判断"同步期间有没有又改"用 beginSync/endSync 的**本地↔本地内容快照**比对(同一份客户端
 *   序列化),**不和服务器内容比**——服务器存草稿会重新序列化 markdown,逐字比对必然不等、
 *   会每次刷新都误判重存(踩过的坑)。
 * - 提交/丢弃后 clear(),防失效内容被当未同步草稿恢复。
 */
import { useCallback } from 'react';

interface StoredDraft<T> {
  data: T;
  ts: number;
}

const PREFIX = 'lf-draft:';

export interface LocalDraftBuffer<T> {
  /** 打开时调用:本地有未同步内容(存在即未同步)则返回它,否则 null。 */
  loadPending: () => T | null;
  /** 每次改动即时写本地。 */
  onChange: (data: T) => void;
  /** 同步开始:返回当前本地内容快照(传给 endSync)。 */
  beginSync: () => string;
  /** 同步成功:若期间本地内容未变(== 快照)则清空本地(内容已安全落服务器)。 */
  endSync: (snapshot: string) => void;
  /** 提交/丢弃后清空,防失效内容被当草稿恢复。 */
  clear: () => void;
}

export function useLocalDraftBuffer<T>(key: string | null): LocalDraftBuffer<T> {
  const storageKey = key ? `${PREFIX}${key}` : null;

  const readData = useCallback((): T | null => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as StoredDraft<T>).data : null;
    } catch {
      return null; // JSON 损坏/隐私模式 → 视为无本地草稿
    }
  }, [storageKey]);

  const loadPending = useCallback((): T | null => readData(), [readData]);

  const onChange = useCallback(
    (data: T) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ data, ts: Date.now() }));
      } catch {
        // 配额满/隐私模式:静默降级,仍有服务器防抖兜底
      }
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 忽略
    }
  }, [storageKey]);

  // 客户端↔客户端快照,不涉及服务器,无序列化/规范化误差
  const beginSync = useCallback(
    (): string => JSON.stringify(readData()),
    [readData],
  );

  const endSync = useCallback(
    (snapshot: string) => {
      // 同步期间没再改(本地内容 == 开始同步时的快照)→ 清空,内容已安全在服务器
      if (JSON.stringify(readData()) === snapshot) clear();
    },
    [readData, clear],
  );

  return { loadPending, onChange, beginSync, endSync, clear };
}
