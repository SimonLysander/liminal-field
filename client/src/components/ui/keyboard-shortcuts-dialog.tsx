/**
 * KeyboardShortcutsDialog — 快捷键 cheatsheet 浮层
 *
 * 触发：⌘+/（或 Ctrl+/）。在 ProseDraftEditor 顶层挂监听。
 * 内容：项目已注册的 Plate 快捷键 + 项目自定义的 ⌘S 类操作快捷键。
 * 按分组展示，每组左侧标题、右侧两列 "操作 / 按键"。
 */
'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './dialog';

type Shortcut = { label: string; keys: string };
type Group = { title: string; items: Shortcut[] };

/* 平台 detect：Mac 渲染 ⌘ / Option，Windows / Linux 渲染 Ctrl / Alt。
 * 用 navigator.platform 简单可靠；userAgent 容易被 ua-ch 干扰。
 * 服务端渲染态（typeof navigator undefined）默认 Mac，到 client hydrate 后自动校准。 */
const isMac =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform);

/** 把 Mac 风格按键文案翻译成当前平台显示形式 */
function formatKeys(keys: string): string {
  if (isMac) return keys;
  return keys
    .replace(/⌘/g, 'Ctrl')
    .replace(/Option/gi, 'Alt')
    .replace(/Shift/g, 'Shift'); // 保持，跨平台一致
}

// 文案统一用 Mac 形式存（语义清晰），渲染时 formatKeys 翻译
const GROUPS: Group[] = [
  {
    title: '块级',
    items: [
      { label: '标题 1 / 2 / 3', keys: '⌘ + Option + 1 / 2 / 3' },
      { label: '标题 4 / 5 / 6', keys: '⌘ + Option + 4 / 5 / 6' },
      { label: '引用', keys: '⌘ + Shift + .' },
      { label: '代码块', keys: '⌘ + Option + 8' },
      { label: '块菜单（⋮⋮ 浮层 → Turn into）', keys: 'hover 块左侧点 ⋮⋮' },
    ],
  },
  {
    title: '内联格式',
    items: [
      { label: '粗体', keys: '⌘ + B' },
      { label: '斜体', keys: '⌘ + I' },
      { label: '下划线', keys: '⌘ + U' },
      { label: '行内代码', keys: '⌘ + E' },
      { label: '删除线', keys: '⌘ + Shift + X' },
      { label: '高亮', keys: '⌘ + Shift + H' },
      { label: '上标 / 下标', keys: '⌘ + . / ⌘ + ,' },
    ],
  },
  {
    title: '文档操作',
    items: [
      { label: '提交版本', keys: '⌘ + S' },
      { label: '保存草稿（不提交）', keys: '⌘ + Shift + S' },
      { label: '打开快捷键面板', keys: '⌘ + /' },
    ],
  },
  {
    title: '编辑器输入约定',
    items: [
      { label: '行首 # / ## / ### + 空格', keys: '转标题' },
      { label: '行首 - / * + 空格', keys: '转无序列表' },
      { label: '行首 1. + 空格', keys: '转有序列表' },
      { label: '行首 > + 空格', keys: '转引用' },
      { label: '```（三个反引号） + Enter', keys: '转代码块' },
      { label: '/ 在空块', keys: '打开斜杠插入菜单' },
    ],
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="text-base font-medium">快捷键</DialogTitle>
        <DialogDescription className="sr-only">
          编辑器全部可用快捷键的对照表
        </DialogDescription>
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3
                className="mb-2 text-xs font-medium tracking-wide"
                style={{ color: 'var(--ink-ghost)' }}
              >
                {g.title}
              </h3>
              <dl className="flex flex-col gap-1">
                {g.items.map((it) => (
                  <div
                    key={it.label}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <dt style={{ color: 'var(--ink)' }}>{it.label}</dt>
                    <dd
                      className="font-mono text-xs"
                      style={{ color: 'var(--ink-faded)' }}
                    >
                      {formatKeys(it.keys)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* useKeyboardShortcutsDialog hook 已拆到 @/hooks/use-keyboard-shortcuts-dialog
 * 避免 react-refresh "only-export-components" 报错（同文件混 component + hook
 * export 不允许） */
