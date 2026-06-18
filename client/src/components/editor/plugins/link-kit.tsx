'use client';

import { LinkRules } from '@platejs/link';
import { LinkPlugin } from '@platejs/link/react';

import { LinkElement } from '@/components/ui/link-node';
import { LinkFloatingToolbar } from '@/components/ui/link-toolbar';

export const LinkKit = [
  LinkPlugin.configure({
    options: {
      // ⌘+K 弹链接 input 浮层（选中文字时自动以选中段为锚）
      triggerFloatingLinkHotkeys: 'mod+k',
    },
    inputRules: [
      LinkRules.markdown(),
      // paste variant 撤回（"选中文字 + ⌘V 粘贴 URL → 自动加链接"）：
      // 隐蔽程度高 — 用户不知道剪贴板里碰巧是 URL 时，会把无关链接挂在
      // 选中段落上。保留 space / break 两个明确的输入触发（输入 URL +
      // 空格 / 换行 时才转链接），是用户能预期的行为。
      LinkRules.autolink({ variant: 'space' }),
      LinkRules.autolink({ variant: 'break' }),
    ],
    render: {
      node: LinkElement,
      afterEditable: () => <LinkFloatingToolbar />,
    },
  }),
];
