/**
 * useLocalDraftBuffer — local-first 草稿本地缓冲。
 *
 * 目标:写作工具"一个字都不丢"。每次改动即时同步写 localStorage(零延迟),服务器草稿仍按
 * 1.5s 防抖同步(跨设备/持久)。崩溃/强退/刷新/关页时,本地内容已落盘 → 重开时若本地有
 * 未同步到服务器的改动,优先恢复本地。不依赖任何 unload 钩子(那些本就不可靠)。
 *
 * 竞态防护:onChange 自增 rev;endSync 仅在同步期间无新改动(rev 未变)时才标记已同步,
 * 避免"服务器同步在途时又改了字 → 成功回调误标已同步 → 那次改动丢失"。
 *
 * 失效清理:提交/丢弃后必须 clear(),否则下次打开会把已提交/已丢弃的内容当未同步草稿恢复。
 */
import { useCallback, useRef } from 'react';

interface StoredDraft<T> {
  data: T;
  /** 客户端时间:最后一次本地写入 */
  ts: number;
  /** true = 本地有尚未确认同步到服务器的改动 */
  pendingSync: boolean;
}

const PREFIX = 'lf-draft:';

export interface LocalDraftBuffer<T> {
  /** 打开时调用:本地有未同步改动则返回它(应覆盖服务器草稿恢复),否则 null。 */
  loadPending: () => T | null;
  /** 每次改动即时写本地、标记未同步。 */
  onChange: (data: T) => void;
  /** 服务器同步开始:返回 rev token。 */
  beginSync: () => number;
  /** 服务器同步成功:传入 beginSync 的 token,若期间无新改动则标记已同步。 */
  endSync: (token: number) => void;
  /** 提交/丢弃后清除本地草稿,防止失效内容被当草稿恢复。 */
  clear: () => void;
}

export function useLocalDraftBuffer<T>(key: string | null): LocalDraftBuffer<T> {
  const revRef = useRef(0);
  const storageKey = key ? `${PREFIX}${key}` : null;

  const readRaw = useCallback((): StoredDraft<T> | null => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as StoredDraft<T>) : null;
    } catch {
      return null; // JSON 损坏/隐私模式禁用 localStorage → 视为无本地草稿
    }
  }, [storageKey]);

  const writeRaw = useCallback(
    (d: StoredDraft<T>) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(d));
      } catch {
        // 配额满/隐私模式:静默降级,仍有服务器防抖兜底
      }
    },
    [storageKey],
  );

  const loadPending = useCallback((): T | null => {
    const d = readRaw();
    return d && d.pendingSync ? d.data : null;
  }, [readRaw]);

  const onChange = useCallback(
    (data: T) => {
      revRef.current += 1;
      writeRaw({ data, ts: Date.now(), pendingSync: true });
    },
    [writeRaw],
  );

  const beginSync = useCallback(() => revRef.current, []);

  const endSync = useCallback(
    (token: number) => {
      if (revRef.current !== token) return; // 同步期间又改了,保持 pendingSync=true
      const d = readRaw();
      if (d && d.pendingSync) writeRaw({ ...d, pendingSync: false });
    },
    [readRaw, writeRaw],
  );

  const clear = useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 忽略
    }
  }, [storageKey]);

  return { loadPending, onChange, beginSync, endSync, clear };
}
