import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { TResolvedSuggestion } from '@platejs/suggestion';
import type { Descendant, TRange } from 'platejs';
import { useEditorRef, useEditorSelector } from 'platejs/react';
import {
  ArrowLeftIcon,
  CheckIcon,
  CornerUpLeftIcon,
  ListMinusIcon,
  PauseIcon,
  PenLineIcon,
  XIcon,
} from 'lucide-react';

import type { InlineAssistAction } from '@/components/editor/inline-assist-events';
import { readNodeText } from '@/components/editor/inline-assist-utils';

export type InlineAssistControlsRect = {
  left: number;
  maxWidth: number;
  top: number;
};

export type InlineAssistState =
  | { status: 'idle' }
  | { status: 'menu'; variant: 'cursor' | 'selection' }
  | {
      status: 'streaming';
      mode: 'insert' | 'suggestion';
      anchorRect?: InlineAssistControlsRect;
    }
  | { status: 'preview' }
  | {
      status: 'suggestion';
      description: TResolvedSuggestion;
      action: InlineAssistAction;
      instruction?: string;
    }
  | { status: 'error'; message: string };

export type InlineAssistRangeRef = {
  current: TRange | null;
  unref: () => void;
};

function isAiPreviewNode(node: unknown): boolean {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as { aiPreview?: unknown }).aiPreview === true
  );
}

function getLastAiPreviewPath(children: Descendant[]): number[] | null {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (isAiPreviewNode(children[index])) return [index];
  }
  return null;
}

function getLastRangeRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  return rects.at(-1) ?? range.getBoundingClientRect() ?? null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function InlineAssistControls({
  state,
  onAccept,
  onBack,
  onCancel,
  onRun,
  onRetry,
}: {
  state: InlineAssistState;
  onAccept: () => void;
  onBack: () => void;
  onCancel: () => void;
  onRun: (action: InlineAssistAction, instruction?: string) => void;
  onRetry: () => void;
}) {
  const editor = useEditorRef();
  const [rect, setRect] = useState<InlineAssistControlsRect | null>(null);
  const [instruction, setInstruction] = useState('');
  const previewSignature = useEditorSelector((e) => {
    let lastIndex = -1;
    let textLength = 0;
    e.children.forEach((node, index) => {
      if (isAiPreviewNode(node)) {
        lastIndex = index;
        textLength += readNodeText(node).length;
      }
    });
    return `${e.children.length}:${lastIndex}:${textLength}`;
  }, []);

  const updateRect = useCallback(() => {
    if (state.status === 'idle') {
      setRect(null);
      return;
    }

    const previewPath = getLastAiPreviewPath(editor.children as Descendant[]);
    const previewEntry = previewPath ? editor.api.node(previewPath) : undefined;
    const previewElement =
      previewEntry?.[0] && 'type' in previewEntry[0]
        ? editor.api.toDOMNode(previewEntry[0])
        : null;
    const previewRect = previewElement?.getBoundingClientRect();
    const anchor = previewPath
      ? editor.api.start(previewPath)
      : editor.selection?.anchor;
    const focus = previewPath
      ? editor.api.end(previewPath)
      : editor.selection?.focus ?? editor.selection?.anchor;
    if (!anchor || !focus) {
      if (state.status === 'menu' || state.status === 'preview') {
        setRect(null);
      }
      return;
    }

    const domRange = editor.api.toDOMRange({ anchor, focus });
    const rangeRect = domRange ? getLastRangeRect(domRange) : null;
    if (!domRange || !rangeRect) {
      if (state.status === 'menu' || state.status === 'preview') {
        setRect(null);
      }
      return;
    }

    const editorElement =
      previewElement?.closest('[data-slate-editor="true"]') ??
      domRange.commonAncestorContainer.parentElement?.closest(
        '[data-slate-editor="true"]',
      );
    const editorRect = editorElement?.getBoundingClientRect();
    const anchorRect = previewRect && previewRect.width > 0 ? previewRect : rangeRect;
    const containerLeft = Math.max(16, editorRect?.left ?? anchorRect.left);
    const containerRight = Math.min(
      window.innerWidth - 16,
      editorRect?.right ?? window.innerWidth - 16,
    );
    const maxWidth = Math.max(260, containerRight - containerLeft);
    const preferredWidth = Math.min(
      maxWidth,
      Math.max(360, Math.min(520, anchorRect.width || 520)),
    );
    const left = clampNumber(
      anchorRect.left,
      containerLeft,
      containerRight - preferredWidth,
    );

    setRect({
      left,
      maxWidth: preferredWidth,
      top: anchorRect.bottom + 6,
    });
  }, [editor, state.status]);

  useLayoutEffect(() => {
    // Positioning this floating surface requires measuring the committed Slate DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateRect();
  }, [previewSignature, state.status, updateRect]);

  useEffect(() => {
    if (state.status !== 'streaming' || !state.anchorRect) {
      return;
    }
    const frame = window.requestAnimationFrame(() =>
      setRect(state.anchorRect!),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  useEffect(() => {
    if (state.status === 'idle') return;
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [state.status, updateRect]);

  if (state.status === 'idle' || !rect) return null;

  return (
    <div
      className="fixed z-[var(--z-dropdown)] overflow-hidden rounded-md border shadow-md"
      contentEditable={false}
      style={{
        background: 'var(--paper)',
        borderColor: 'var(--separator)',
        color: 'var(--ink)',
        left: rect.left,
        maxWidth: rect.maxWidth,
        minWidth: Math.min(360, rect.maxWidth),
        top: rect.top,
        width: rect.maxWidth,
      }}
    >
      <div
        className="flex h-9 items-center px-3 text-sm"
        style={{
          borderBottom: '0.5px solid var(--separator)',
          color: 'var(--ink-ghost)',
        }}
      >
        {state.status === 'menu' ? (
          <>
            <button
              type="button"
              className="mr-2 flex size-6 shrink-0 items-center justify-center rounded text-[var(--ink-ghost)] transition-colors hover:text-[var(--ink)]"
              aria-label="返回一级菜单"
              onClick={onBack}
            >
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-ghost)] hover:!bg-transparent focus:!bg-transparent"
              style={{
                background: 'transparent',
                boxShadow: 'none',
                caretColor: 'var(--accent)',
                color: 'var(--ink)',
              }}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  const value = instruction.trim();
                  if (value) onRun('custom', value);
                }
                if (event.key === 'ArrowLeft') {
                  const target = event.currentTarget;
                  const selectionStart = target.selectionStart ?? 0;
                  const selectionEnd = target.selectionEnd ?? 0;
                  if (
                    !instruction ||
                    (selectionStart === 0 && selectionEnd === 0)
                  ) {
                    event.preventDefault();
                    onBack();
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onBack();
                }
              }}
              placeholder="输入自定义要求..."
              autoFocus
            />
          </>
        ) : (
          <span className="min-w-0 truncate">
            {state.status === 'streaming' &&
              (state.mode === 'suggestion'
                ? '正在生成修改建议...'
                : '正在帮你写...')}
            {state.status === 'preview' && '已生成内容'}
            {state.status === 'suggestion' && '已生成修改建议'}
            {state.status === 'error' && state.message}
          </span>
        )}
      </div>
      <div className="p-1">
        {state.status === 'menu' && (
          <>
            {instruction.trim() && (
              <InlineAssistMenuItem
                active
                icon={<CheckIcon />}
                label="按要求处理"
                onSelect={() => onRun('custom', instruction)}
              />
            )}
            {state.variant === 'cursor' && (
              <InlineAssistMenuItem
                icon={<PenLineIcon />}
                label="续写"
                onSelect={() => onRun('continue')}
              />
            )}
            {state.variant === 'selection' && (
              <>
                <InlineAssistMenuItem
                  icon={<ListMinusIcon />}
                  label="简写"
                  onSelect={() => onRun('make-shorter')}
                />
                <InlineAssistMenuItem
                  icon={<CheckIcon />}
                  label="修订"
                  onSelect={() => onRun('revise')}
                />
              </>
            )}
          </>
        )}
        {state.status === 'streaming' && (
          <InlineAssistMenuItem
            icon={<PauseIcon />}
            label="停止"
            shortcut="Esc"
            onSelect={onCancel}
          />
        )}
        {state.status === 'preview' && (
          <>
            <InlineAssistMenuItem
              active
              icon={<CheckIcon />}
              label="接受"
              onSelect={onAccept}
            />
            <InlineAssistMenuItem
              icon={<XIcon />}
              label="丢弃"
              onSelect={onCancel}
            />
            <InlineAssistMenuItem
              icon={<CornerUpLeftIcon />}
              label="重试"
              onSelect={onRetry}
            />
          </>
        )}
        {state.status === 'suggestion' && (
          <>
            <InlineAssistMenuItem
              active
              icon={<CheckIcon />}
              label="接受"
              onSelect={onAccept}
            />
            <InlineAssistMenuItem
              icon={<XIcon />}
              label="丢弃"
              onSelect={onCancel}
            />
          </>
        )}
        {state.status === 'error' && (
          <>
            <InlineAssistMenuItem
              icon={<CornerUpLeftIcon />}
              label="重试"
              onSelect={onRetry}
            />
            <InlineAssistMenuItem
              icon={<XIcon />}
              label="关闭"
              onSelect={onCancel}
            />
          </>
        )}
      </div>
    </div>
  );
}

function InlineAssistMenuItem({
  icon,
  active,
  label,
  onSelect,
  shortcut,
}: {
  icon: React.ReactNode;
  active?: boolean;
  label: string;
  onSelect: () => void;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:bg-[var(--shelf)]"
      style={{
        background: active ? 'var(--shelf)' : undefined,
        color: 'var(--ink)',
      }}
      onClick={onSelect}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-[var(--ink-ghost)] [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <kbd
          className="ml-3 rounded px-1 font-mono text-[10px]"
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink-ghost)',
          }}
        >
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
