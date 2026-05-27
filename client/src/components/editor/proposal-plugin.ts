import { createPlatePlugin } from 'platejs/react';

import { ProposalNewElement } from './proposal-new-element';
import { ProposalOldElement } from './proposal-old-element';

export const PROPOSAL_OLD = 'proposal-old';
export const PROPOSAL_NEW = 'proposal-new';

/**
 * ProposalPlugin —— v3.1 改稿审批节点。
 *
 * 注册两种自定义 block element type:
 *   - proposal-old: 被替换/删除的旧段落,红底 + line-through
 *   - proposal-new: AI 提议的新段落,绿底
 *
 * 节点 type 在裁决期间临时存在;接受/拒绝时由 controller 将 type 改回 'p' 或 removeNodes。
 * 节点携带 `hunkId` 属性,按钮回调通过它找回对应 hunk。
 *
 * API 模式参照项目内 AiReferenceComposer.tsx 的 ReferenceTokenPlugin。
 */
export const ProposalOldPlugin = createPlatePlugin({
  key: PROPOSAL_OLD,
  node: {
    isElement: true,
    component: ProposalOldElement,
  },
});

export const ProposalNewPlugin = createPlatePlugin({
  key: PROPOSAL_NEW,
  node: {
    isElement: true,
    component: ProposalNewElement,
  },
});
