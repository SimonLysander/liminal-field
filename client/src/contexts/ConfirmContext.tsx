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
import { Button } from '@/components/ui/button';

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
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={(e) => e.target === e.currentTarget && handleClose(false)}
          >
            <motion.div
              className="w-[360px] rounded-xl"
              style={{
                background: 'var(--paper)',
                boxShadow: 'var(--shadow-lg)',
              }}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: smoothBounce }}
            >
              <div className="px-6 pb-2 pt-5">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
                  {state.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
                  {state.message}
                </p>
              </div>

              <div className="flex justify-end gap-2 px-6 pb-5 pt-4">
                <Button variant="ghost" size="sm" type="button" onClick={() => handleClose(false)}>
                  {state.cancelLabel ?? '取消'}
                </Button>
                {/* 危险操作 → danger 红字;否则 → 长春花紫 primary(对齐"主操作=accent"纲领) */}
                <Button
                  variant={state.danger ? 'danger' : 'primary'}
                  size="sm"
                  type="button"
                  onClick={() => handleClose(true)}
                >
                  {state.confirmLabel ?? '确认'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
