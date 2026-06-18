'use client';

import * as React from 'react';

import type { WithRequiredKey } from 'platejs';

import {
  useImagePreviewValue,
} from '@platejs/media/react';
import { Trash2Icon } from 'lucide-react';
import {
  useEditorRef,
  useEditorSelector,
  useElement,
  useFocusedLast,
  useReadOnly,
  useRemoveNodeButton,
  useSelected,
} from 'platejs/react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';

import { CaptionButton } from './caption';

/* plugin 参数保留：未来若重新引入 embed/video 节点需要它来标识浮层归属。
 * 当前实现没用，故意不在 destructure 里取，避免 eslint no-unused-vars。 */
export function MediaToolbar(props: {
  children: React.ReactNode;
  plugin: WithRequiredKey;
}) {
  const { children } = props;
  const editor = useEditorRef();
  const readOnly = useReadOnly();
  const selected = useSelected();
  const isFocusedLast = useFocusedLast();
  const selectionCollapsed = useEditorSelector(
    (editor) => !editor.api.isExpanded(),
    [],
  );
  const isImagePreviewOpen = useImagePreviewValue('isOpen', editor.id);
  const open =
    isFocusedLast &&
    !readOnly &&
    selected &&
    selectionCollapsed &&
    !isImagePreviewOpen;

  const element = useElement();
  const { props: buttonProps } = useRemoveNodeButton({ element });

  // 去掉 "Edit link"：项目图片/文件都是上传到自家 MinIO/OSS，src 固定不会变；
  // editor-kit 注释明确"只注册 image + file"，video/embed 死代码，
  // 不需要给用户改 src URL 的入口。
  // 留 "说明"（caption）和"删除"两个操作。
  return (
    <Popover open={open} modal={false}>
      <PopoverAnchor>{children}</PopoverAnchor>

      <PopoverContent
        className="w-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="box-content flex items-center gap-1">
          <CaptionButton size="sm" variant="ghost">
            说明
          </CaptionButton>
          <Button size="sm" variant="ghost" {...buttonProps}>
            <Trash2Icon />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
