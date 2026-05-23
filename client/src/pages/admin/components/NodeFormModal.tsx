import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, FileText } from 'lucide-react';
import type { StructureNodeType } from '@/services/structure';
import { parseError } from '../helpers';
import { type ModalState, type NodeSubmitPayload } from '../types';
import { importApi } from '@/services/import';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { Modal } from '@/components/shared/Modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';

/**
 * Modal dialog for creating or editing tree nodes.
 *
 * Create mode: user picks "主题"(FOLDER) or "文稿"(DOC), enters a name.
 * DOC creation uses node name as content title — no separate title/summary fields.
 * Edit mode: simple rename dialog.
 *
 * 外壳迁移：原 fixed inset-0 + blur + motion → 统一 <Modal> 标准组件（L3）。
 * open 固定传 true：组件只在 workspace.modal.open 时被渲染，渲染即打开。
 * ThresholdOverlay 放在 Modal 外层，保证导入时全屏遮罩正常显示。
 * 对外 props 签名不变：{ modal, onClose, onSubmit }。
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
      onClose();
      const params = new URLSearchParams({ parseId: result.parseId });
      if (modal.parentId) params.set('parentId', modal.parentId);
      navigate(`/admin/notes/import-preview?${params.toString()}`);
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
      {/* ThresholdOverlay 放在 Modal 外层，确保文件导入时全屏遮罩可见 */}
      <ThresholdOverlay visible={importing} label="正在解析文件..." />
      <Modal
        open
        onClose={onClose}
        title={isCreate ? '新建' : '重命名'}
        footer={
          <>
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="node-form-modal-form"
              disabled={submitting}
            >
              {submitting ? '提交中...' : isCreate ? '创建' : '保存'}
            </Button>
          </>
        }
      >
        <form id="node-form-modal-form" onSubmit={handleSubmit} className="space-y-4">
          <FieldLabel label="名称">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCreate && type === 'DOC' ? '例如：世界观构建笔记' : '例如：世界观构建'}
              autoFocus
            />
          </FieldLabel>

          {isCreate && (
            <FieldLabel label="类型">
              {/* 类型切换按钮组：自定义选中态（accent），原样保留逻辑与样式 */}
              <div className="flex gap-1.5">
                {typeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setType(option.value)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors duration-150"
                    style={{
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
                className="w-full rounded-lg py-2 text-center text-sm font-medium transition-opacity duration-150 disabled:opacity-50"
                style={{
                  background: 'var(--shelf)',
                  color: 'var(--ink-faded)',
                  border: '1px dashed var(--separator)',
                }}
              >
                {importing ? '解析中...' : '从文件导入'}
              </button>
            </>
          )}

          <FieldError>{error}</FieldError>
        </form>
      </Modal>
    </>
  );
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium" style={{ color: 'var(--ink-ghost)' }}>{label}</span>
      {children}
    </label>
  );
}
