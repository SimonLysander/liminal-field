/**
 * ConfirmContext — 全局确认对话框，替代 window.confirm。
 *
 * 用法：
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: '...', message: '...' });
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { smoothBounce } from '@/lib/motion';

interface ConfirmOptions {
  title: string;
  message: string;
  /** 确认按钮文本，默认"确认" */
  confirmLabel?: string;
  /** 取消按钮文本，默认"取消" */
  cancelLabel?: string;
  /** 确认按钮是否为危险色（红色），默认 false */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used within ConfirmProvider');
  return fn;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { visible: true }) | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, visible: true });
    });
  }, []);

  const handleClose = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  // Escape 键关闭对话框（视为取消）
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, handleClose]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => e.target === e.currentTarget && handleClose(false)}
          >
            <motion.div
              className="w-[360px]"
              style={{
                background: 'var(--paper)',
                borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-lg)',
              }}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: smoothBounce }}
            >
              <div className="px-6 pb-2 pt-5">
                <h3 className="font-semibold" style={{ color: 'var(--ink)', fontSize: 'var(--text-lg)' }}>
                  {state.title}
                </h3>
                <p className="mt-2 leading-relaxed" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}>
                  {state.message}
                </p>
              </div>

              <div className="flex justify-end gap-2 px-6 pb-5 pt-4">
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 font-medium"
                  style={{ background: 'var(--shelf)', color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}
                  onClick={() => handleClose(false)}
                >
                  {state.cancelLabel ?? '取消'}
                </button>
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 font-medium"
                  style={{
                    background: state.danger ? 'var(--mark-red)' : 'var(--ink)',
                    color: '#fff',
                    fontSize: 'var(--text-sm)',
                  }}
                  onClick={() => handleClose(true)}
                >
                  {state.confirmLabel ?? '确认'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
