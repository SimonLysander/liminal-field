import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseError } from '../helpers';
import { type ModalState, type NodeSubmitPayload } from '../types';
import { importApi } from '@/services/import';
import { setPendingImportFiles } from '../batch-import-store';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { Modal } from '@/components/shared/Modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';

/**
 * Modal dialog for creating or editing tree nodes.
 *
 * 节点同质化(2026-05-29):不再区分主题/文稿,新建即"建一个页面"(都有正文、都能挂子节点)。
 * Create mode: 只输名称 → 建页面 → 跳编辑器(沿用原 DOC 行为);可选「从文件导入」。
 * 页面成为"容器"是因为它有了子节点,不在创建时选类型。
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
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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
            // 节点同质化:新建即一个页面。type 仅为兼容 DTO,后端已忽略(由是否有子节点决定容器性)。
            name: name.trim(),
            type: 'DOC',
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

  /* 导入文件夹:目录批量导入。从「新建」触发(导入是创建级动作,挂在节点上别扭),导进当前位置。 */
  const handleFolderClick = () => folderInputRef.current?.click();

  const handleFolderSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let hasMd = false;
    for (let i = 0; i < files.length; i++) {
      if (files[i].webkitRelativePath.endsWith('.md')) {
        hasMd = true;
        break;
      }
    }
    if (!hasMd) {
      setError('文件夹中未找到 .md 文件');
      e.target.value = '';
      return;
    }
    // FileList 不支持 structured clone,存到模块变量(与原 FolderOverviewPanel 一致)
    setPendingImportFiles(files);
    onClose();
    const params = new URLSearchParams();
    if (modal.parentId) params.set('parentId', modal.parentId);
    navigate(`/admin/notes/batch-import?${params.toString()}`);
    e.target.value = '';
  };

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
              placeholder="例如：世界观构建"
              autoFocus
            />
          </FieldLabel>

          {isCreate && (
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
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitdirectory 非标准属性
                {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
                onChange={handleFolderSelected}
              />
              <button
                type="button"
                onClick={handleFolderClick}
                className="w-full rounded-lg py-2 text-center text-sm font-medium transition-opacity duration-150"
                style={{
                  background: 'var(--shelf)',
                  color: 'var(--ink-faded)',
                  border: '1px dashed var(--separator)',
                }}
              >
                导入文件夹
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
