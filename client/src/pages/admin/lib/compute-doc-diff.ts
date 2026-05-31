/**
 * compute-doc-diff —— v3 改稿核心算法:smart LCS。
 *
 * 输入:
 *   - oldChildren: 当前编辑器的 editor.children
 *   - newChildren: 调用者已通过 deserializeMd(editor, newMarkdown) 反序列化后的节点
 *
 * 输出:Hunk[](块级 LCS + 改动块内字符级 LCS)
 *
 * 职责边界:
 *   - 本模块只负责"块间 LCS + 字符级 inline diff",不碰 markdown 解析
 *   - 调用者在浏览器内应使用 Plate 真正的 deserializeMd(editor, markdown),
 *     保证节点结构和编辑器一致;测试可直接构造 Descendant[]
 *
 * 算法:
 * 1. 块间 LCS:签名 = `${type}:${blockText}`;撞坑按 index 顺序兜底
 * 2. replace 块内:字符级 LCS 出 InlineSegment[]
 * 3. 结构变化(段→标题)由相邻 delete+insert 合并为 replace
 *
 * 业界依据:Liveblocks/Moment.dev 工程博客明确证伪"模型自报 node ID",
 * 主流方案是"模型只生成新版本,系统算法 LCS 算位置"。这就是该模块的责任边界。
 */

import type { Descendant, Path } from 'platejs';

// ────────────────────────────────────────────────────────────────────────────
// 公共类型
// ────────────────────────────────────────────────────────────────────────────

export interface InlineSegment {
  kind: 'eq' | 'del' | 'ins';
  text: string;
}

export interface Hunk {
  id: string;
  kind: 'replace' | 'insert' | 'delete';
  /**
   * 在旧文档中的块路径。语义随 kind 不同:
   * - replace / delete:目标块的路径(被替换 / 删除的块)
   * - insert:插入点的路径(新块要插到该 index 的位置;afterOldIdx=-1 时为 [0])
   */
  blockPath?: Path;
  oldRange?: { start: Path; end: Path };
  newBlocks?: Descendant[];
  oldText?: string;
  newText?: string;
  inlineDiff?: InlineSegment[];
}

// ────────────────────────────────────────────────────────────────────────────
// 辅助:提取块纯文本
// ────────────────────────────────────────────────────────────────────────────

function blockText(block: Descendant): string {
  const b = block as Record<string, unknown>;
  if (Array.isArray(b['children'])) {
    return (b['children'] as Array<Record<string, unknown>>)
      .map((c) => (typeof c['text'] === 'string' ? c['text'] : ''))
      .join('');
  }
  return '';
}

function blockSignature(block: Descendant): string {
  const type = (block as { type?: string }).type ?? 'unknown';
  return `${type}:${blockText(block)}`;
}

/**
 * 基于 kind + blockPath 的稳定 hunk ID。
 *
 * 早期实现用 `Math.random()`,导致 computeDocDiff 每次调用都出全新 ID。
 * 配合 useMemo(`v3ProposalsByCallId`)+ useEffect 链路会触发 Max update depth
 * 死循环:pendingProposal 引用持续变化 → AdvisorSidebar effect 跑 → setState →
 * 父 re-render → useChat messages 引用可能变 → useMemo 重算 → 又出新 hunks → ...
 *
 * 用 kind:blockPath 作 ID,相同 oldChildren + newChildren 出相同 hunks,引用稳定。
 */
/**
 * ID 同时编码 oldIdx 和 newIdx,确保 hunks 唯一:
 * - replace:oldIdx + newIdx 都参与(同 oldIdx 可对应不同 newIdx)
 * - delete:仅 oldIdx(newIdx 用 'x' 占位)
 * - insert:仅 newIdx(oldIdx 用 'x' 占位)
 *
 * 避免 `h_insert_4` 三个 hunks 同 ID → React key 冲突只渲染 1 个的 bug。
 */
function makeHunkId(kind: string, oldIdx: number | null, newIdx: number | null): string {
  return `h_${kind}_${oldIdx ?? 'x'}_${newIdx ?? 'x'}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 字符级 LCS diff
// ────────────────────────────────────────────────────────────────────────────

/**
 * 字符级 LCS,返回 InlineSegment[]。
 * 短文本场景 O(NM);长块超 5000 字符按整块替换兜底,避免性能爆炸。
 */
function charDiff(oldText: string, newText: string): InlineSegment[] {
  if (oldText.length > 5000 || newText.length > 5000) {
    return [
      { kind: 'del', text: oldText },
      { kind: 'ins', text: newText },
    ];
  }
  const m = oldText.length;
  const n = newText.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldText[i - 1] === newText[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 回溯:构建操作序列(倒序收集,最后反转)
  const segs: InlineSegment[] = [];
  let i = m;
  let j = n;
  // 累积缓冲,避免每字符一个 segment
  let bufEq = '';
  let bufDel = '';
  let bufIns = '';

  // 进入 eq 段前:刷出已积累的 del/ins(优先于 eq 输出)
  const flushDelIns = () => {
    if (bufDel) { segs.unshift({ kind: 'del', text: bufDel }); bufDel = ''; }
    if (bufIns) { segs.unshift({ kind: 'ins', text: bufIns }); bufIns = ''; }
  };

  // 进入 del/ins 段前:刷出已积累的 eq
  const flushEq = () => {
    if (bufEq) { segs.unshift({ kind: 'eq', text: bufEq }); bufEq = ''; }
  };

  // 末尾全量刷新:del/ins 先于 eq
  const flush = () => {
    flushDelIns();
    flushEq();
  };

  while (i > 0 && j > 0) {
    if (oldText[i - 1] === newText[j - 1]) {
      // eq 字符;先把前面积累的 del/ins 刷出去
      flushDelIns();
      bufEq = oldText[i - 1] + bufEq;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      // del:消耗 old 字符
      flushEq();
      bufDel = oldText[i - 1] + bufDel;
      i--;
    } else {
      // ins:消耗 new 字符
      flushEq();
      bufIns = newText[j - 1] + bufIns;
      j--;
    }
  }

  // 消耗剩余
  while (i > 0) { bufDel = oldText[i - 1] + bufDel; i--; }
  while (j > 0) { bufIns = newText[j - 1] + bufIns; j--; }
  flush();

  return segs;
}

// ────────────────────────────────────────────────────────────────────────────
// 块间 LCS 对齐
// ────────────────────────────────────────────────────────────────────────────

type AlignOp =
  | { op: 'eq'; oldIdx: number; newIdx: number }
  | { op: 'replace'; oldIdx: number; newIdx: number }
  | { op: 'insert'; newIdx: number; afterOldIdx: number }
  | { op: 'delete'; oldIdx: number };

/**
 * 块间 LCS,输出对齐操作序列。
 * 相邻的 delete + insert 合并为 replace(处理块级内容替换和结构变化)。
 * afterOldIdx 语义:insert 发生在 "old[afterOldIdx]" 之后;-1 表示插入在开头。
 *
 * 回溯优先级:dp 相等时优先走 insert,确保替换场景始终产出 [delete, insert] 经典顺序,
 * 使合并逻辑安全可靠,不会因逆序产生跨位置误配对。
 */
function alignBlocks(oldBlocks: Descendant[], newBlocks: Descendant[]): AlignOp[] {
  const oldSigs = oldBlocks.map(blockSignature);
  const newSigs = newBlocks.map(blockSignature);
  const m = oldSigs.length;
  const n = newSigs.length;

  // dp[i][j] = LCS 长度(前 i 个 old vs 前 j 个 new)
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let ii = 1; ii <= m; ii++) {
    for (let jj = 1; jj <= n; jj++) {
      dp[ii][jj] =
        oldSigs[ii - 1] === newSigs[jj - 1]
          ? dp[ii - 1][jj - 1] + 1
          : Math.max(dp[ii - 1][jj], dp[ii][jj - 1]);
    }
  }

  // 回溯:收集原始 delete / insert / eq
  // 优先级:dp 相等时优先走 insert(jj--)再走 delete(ii--)。
  // 这保证单块替换场景下回溯产出 [delete, insert] 经典顺序,
  // 而非 [insert(afterOldIdx=-1), delete] 逆序——逆序无法保证合并语义正确。
  const raw: AlignOp[] = [];
  let ii = m;
  let jj = n;
  while (ii > 0 && jj > 0) {
    if (oldSigs[ii - 1] === newSigs[jj - 1]) {
      raw.unshift({ op: 'eq', oldIdx: ii - 1, newIdx: jj - 1 });
      ii--;
      jj--;
    } else if (dp[ii - 1][jj] > dp[ii][jj - 1]) {
      // delete 严格更优时才走 delete
      raw.unshift({ op: 'delete', oldIdx: ii - 1 });
      ii--;
    } else {
      // dp 相等或 insert 更优:优先走 insert
      raw.unshift({ op: 'insert', newIdx: jj - 1, afterOldIdx: ii - 1 });
      jj--;
    }
  }
  while (ii > 0) { raw.unshift({ op: 'delete', oldIdx: ii - 1 }); ii--; }
  while (jj > 0) { raw.unshift({ op: 'insert', newIdx: jj - 1, afterOldIdx: -1 }); jj--; }

  // 合并连续的 delete + insert 块为 replace 对(zip-pair):
  // LCS 回溯产出顺序在"全替换"场景里是 [D0,D1,...,I0,I1,...]——
  // 旧逻辑只合并相邻一对 (D, I),剩余 delete 和 insert 散落 → 7 处改动错位 hunks。
  // 改为:收集连续的 delete[] 和紧跟的 insert[],按 index 顺序逐对 zip-pair 成 replace,
  // 多余的留单独 delete 或 insert(段数不等时)。
  const merged: AlignOp[] = [];
  let k = 0;
  while (k < raw.length) {
    if (raw[k].op === 'eq') {
      merged.push(raw[k]);
      k++;
      continue;
    }
    // 收集连续的 delete 段
    const deletes: { oldIdx: number }[] = [];
    while (k < raw.length && raw[k].op === 'delete') {
      deletes.push({ oldIdx: (raw[k] as { oldIdx: number }).oldIdx });
      k++;
    }
    // 紧跟着收集连续的 insert 段
    const inserts: { newIdx: number; afterOldIdx: number }[] = [];
    while (k < raw.length && raw[k].op === 'insert') {
      const op = raw[k] as { newIdx: number; afterOldIdx: number };
      inserts.push({ newIdx: op.newIdx, afterOldIdx: op.afterOldIdx });
      k++;
    }
    // zip-pair:同 index 的 delete[i] + insert[i] → replace
    const pairs = Math.min(deletes.length, inserts.length);
    for (let p = 0; p < pairs; p++) {
      merged.push({ op: 'replace', oldIdx: deletes[p].oldIdx, newIdx: inserts[p].newIdx });
    }
    // 多余 delete(段数 old > new)
    for (let p = pairs; p < deletes.length; p++) {
      merged.push({ op: 'delete', oldIdx: deletes[p].oldIdx });
    }
    // 多余 insert(段数 new > old)
    for (let p = pairs; p < inserts.length; p++) {
      merged.push({ op: 'insert', newIdx: inserts[p].newIdx, afterOldIdx: inserts[p].afterOldIdx });
    }
  }

  return merged;
}

// ────────────────────────────────────────────────────────────────────────────
// 主函数
// ────────────────────────────────────────────────────────────────────────────

/**
 * 计算两组 Plate 节点之间的块级 + 字符级 diff。
 *
 * @param oldChildren 当前编辑器 editor.children
 * @param newChildren 调用者已 deserializeMd 后的节点(由调用者负责)
 *   - 浏览器环境:使用 Plate 真正的 deserializeMd(editor, markdown),保证节点结构和编辑器一致
 *   - 测试环境:直接构造 mock Descendant[]
 */
export function computeDocDiff(
  oldChildren: Descendant[],
  newChildren: Descendant[],
): Hunk[] {
  // 过滤"末尾空段"假阳性:Plate 内部强制 editor.children 末尾保留一个空 paragraph,
  // 模型给的 newMarkdown 通常不带这个空段 → LCS 算成"delete 末尾空段"hunk,
  // 用户看到一个空的红底块,毫无意义。
  // 同样过滤新文档末尾如有空段。
  const filteredOld = oldChildren.filter((b, i, arr) => {
    if (i !== arr.length - 1) return true; // 非末尾保留
    return blockText(b).trim().length > 0; // 末尾非空才保留
  });
  const filteredNew = newChildren.filter((b, i, arr) => {
    if (i !== arr.length - 1) return true;
    return blockText(b).trim().length > 0;
  });
  const ops = alignBlocks(filteredOld, filteredNew);
  const hunks: Hunk[] = [];

  for (const op of ops) {
    if (op.op === 'eq') continue;

    if (op.op === 'replace') {
      const oldBlock = oldChildren[op.oldIdx];
      const newBlock = newChildren[op.newIdx];
      const oldTxt = blockText(oldBlock);
      const newTxt = blockText(newBlock);
      const path = [op.oldIdx];
      hunks.push({
        id: makeHunkId('replace', op.oldIdx, op.newIdx),
        kind: 'replace',
        blockPath: path,
        oldRange: { start: [op.oldIdx, 0], end: [op.oldIdx, 0] },
        newBlocks: [newBlock],
        oldText: oldTxt,
        newText: newTxt,
        // 同类型块且文本变化才做 inlineDiff;结构变化(type 不同)整块替换,inlineDiff 留 undefined
        inlineDiff:
          (oldBlock as { type?: string }).type === (newBlock as { type?: string }).type &&
          oldTxt !== newTxt
            ? charDiff(oldTxt, newTxt)
            : undefined,
      });
    } else if (op.op === 'delete') {
      const oldBlock = oldChildren[op.oldIdx];
      const path = [op.oldIdx];
      hunks.push({
        id: makeHunkId('delete', op.oldIdx, null),
        kind: 'delete',
        blockPath: path,
        oldRange: { start: [op.oldIdx, 0], end: [op.oldIdx, 0] },
        oldText: blockText(oldBlock),
      });
    } else if (op.op === 'insert') {
      const newBlock = newChildren[op.newIdx];
      const path = [op.afterOldIdx + 1];
      hunks.push({
        id: makeHunkId('insert', null, op.newIdx),
        kind: 'insert',
        // blockPath 此处语义为"插入点 index":新块将被插到该位置。
        // afterOldIdx=-1 表示插在开头(index=0);否则插在 afterOldIdx+1 位置。
        // 注意:与 replace/delete 的"目标块路径"语义不同。
        blockPath: path,
        newBlocks: [newBlock],
        newText: blockText(newBlock),
      });
    }
  }

  return hunks;
}
