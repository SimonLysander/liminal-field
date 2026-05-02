import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Folder, FileText } from 'lucide-react';
import { smoothBounce } from '@/lib/motion';
import type { StructureNodeType } from '@/services/structure';
import { parseError } from '../helpers';
import { type ModalState, type NodeSubmitPayload } from '../types';
import { importApi } from '@/services/import';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';

/**
 * Modal dialog for creating or editing tree nodes.
 *
 * Create mode: user picks "主题"(FOLDER) or "文稿"(DOC), enters a name.
 * DOC creation uses node name as content title — no separate title/summary fields.
 * Edit mode: simple rename dialog.
 */
export const NodeFormModal = ({
  modal,
  onClose,
  onSubmit,
}: {
  modal: ModalState;
  onClose: () => void;
  onSubmit: (payload: NodeSubmitPayload) => Promise<void>;
}) => {
  const [name, setName] = useState(modal.node?.name ?? '');
  const [type, setType] = useState<StructureNodeType>(modal.node?.type ?? 'FOLDER');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const isCreate = modal.mode === 'create';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      setError('请输入名称');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      if (isCreate) {
        await onSubmit({
          node: {
            name: name.trim(),
            type,
            parentId: modal.parentId,
          },
        });
      } else {
        await onSubmit({
          node: {
            name: name.trim(),
          },
        });
      }
      onClose();
    } catch (submitError) {
      setError(parseError(submitError, '提交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError('');
    try {
      const result = await importApi.parse(file);
      // 存储 parse 结果到 sessionStorage，预览页使用
      sessionStorage.setItem(`import-${result.parseId}`, JSON.stringify(result));
      onClose();
      const params = new URLSearchParams({ parseId: result.parseId });
      if (modal.parentId) params.set('parentId', modal.parentId);
      navigate(`/admin/content/import-preview?${params.toString()}`);
    } catch (err) {
      setError(parseError(err, '文件解析失败'));
    } finally {
      setImporting(false);
    }
  };

  const typeOptions: { value: StructureNodeType; label: string; icon: React.ReactNode }[] = [
    { value: 'FOLDER', label: '主题', icon: <Folder size={15} strokeWidth={1.5} /> },
    { value: 'DOC', label: '文稿', icon: <FileText size={15} strokeWidth={1.5} /> },
  ];

  return (
    <>
    <ThresholdOverlay visible={importing} label="正在解析文件..." />
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="w-[420px] overflow-hidden"
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: smoothBounce }}
      >
        <div className="px-6 pb-1 pt-5">
          <h2 className="font-semibold" style={{ color: 'var(--ink)', fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>
            {isCreate ? '新建' : '重命名'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6 pt-3">
          <FieldLabel label="名称">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border-none px-3 py-2 outline-none"
              style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)' }}
              placeholder={isCreate && type === 'DOC' ? '例如：世界观构建笔记' : '例如：世界观构建'}
              autoFocus
            />
          </FieldLabel>

          {isCreate && (
            <FieldLabel label="类型">
              <div className="flex gap-1.5">
                {typeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setType(option.value)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-colors duration-150"
                    style={{
                      fontSize: 'var(--text-sm)',
                      background: type === option.value ? 'var(--accent)' : 'var(--shelf)',
                      color: type === option.value ? 'var(--accent-contrast)' : 'var(--ink-faded)',
                    }}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
            </FieldLabel>
          )}

          {isCreate && type === 'DOC' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.docx,.pdf,.pptx"
                className="hidden"
                onChange={handleFileSelected}
              />
              <button
                type="button"
                onClick={handleImportClick}
                disabled={importing}
                className="w-full rounded-lg py-2 text-center font-medium transition-opacity duration-150 disabled:opacity-50"
                style={{
                  background: 'var(--shelf)',
                  color: 'var(--ink-faded)',
                  fontSize: 'var(--text-sm)',
                  border: '1px dashed var(--separator)',
                }}
              >
                {importing ? '解析中...' : '从文件导入'}
              </button>
            </>
          )}

          {error && (
            <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-xs)' }}>{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="rounded-lg px-4 py-2 font-medium"
              style={{ background: 'var(--shelf)', color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-4 py-2 font-medium transition-opacity duration-150 disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 'var(--text-sm)' }}
            >
              {submitting ? '提交中...' : isCreate ? '创建' : '保存'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
    </>
  );
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>{label}</span>
      {children}
    </label>
  );
}
