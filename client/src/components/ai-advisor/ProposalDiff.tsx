/**
 * ProposalDiff — 行内字符级 diff 展示：删除=删除线淡墨，插入=accent 背景。
 *
 * 用于 AiEditProposalCard 展示改动片段。tokenize 到单词/中文单字/标点粒度，
 * 使行内 diff 可读性更高（不是字符级也不是行级）。
 */

export type DiffToken =
  | { type: 'equal'; text: string }
  | { type: 'delete'; text: string }
  | { type: 'insert'; text: string };

export function ProposalDiff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <>
      {diffText(oldText, newText).map((part, index) => {
        if (part.type === 'equal') return <span key={index}>{part.text}</span>;
        if (part.type === 'delete') {
          return (
            <span
              key={index}
              className="line-through decoration-[var(--ink-ghost)]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {part.text}
            </span>
          );
        }
        return (
          <span
            key={index}
            className="rounded-[3px] px-0.5"
            style={{
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              color: 'var(--ink)',
            }}
          >
            {part.text}
          </span>
        );
      })}
    </>
  );
}

// ── 内部工具函数（非导出，仅供 ProposalDiff 组件使用）────────────────────────

function diffText(oldText: string, newText: string): DiffToken[] {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  if (oldTokens.length === 0) return [{ type: 'insert', text: newText }];
  if (newTokens.length === 0) return [{ type: 'delete', text: oldText }];
  if (oldTokens.length * newTokens.length > 120_000) {
    return [
      { type: 'delete', text: oldText },
      { type: 'insert', text: newText },
    ];
  }

  const rows = oldTokens.length + 1;
  const cols = newTokens.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      table[i][j] = oldTokens[i] === newTokens[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < oldTokens.length && j < newTokens.length) {
    if (oldTokens[i] === newTokens[j]) {
      pushDiff(parts, 'equal', oldTokens[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushDiff(parts, 'delete', oldTokens[i]);
      i += 1;
    } else {
      pushDiff(parts, 'insert', newTokens[j]);
      j += 1;
    }
  }
  while (i < oldTokens.length) {
    pushDiff(parts, 'delete', oldTokens[i]);
    i += 1;
  }
  while (j < newTokens.length) {
    pushDiff(parts, 'insert', newTokens[j]);
    j += 1;
  }
  return parts;
}

function pushDiff(parts: DiffToken[], type: DiffToken['type'], text: string) {
  const previous = parts[parts.length - 1];
  if (previous?.type === type) {
    previous.text += text;
    return;
  }
  parts.push({ type, text });
}

function tokenizeForDiff(text: string): string[] {
  const tokens: string[] = [];
  let buffer = '';
  let bufferType: 'word' | 'space' | undefined;

  const flush = () => {
    if (!buffer) return;
    tokens.push(buffer);
    buffer = '';
    bufferType = undefined;
  };

  for (const char of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) {
      flush();
      tokens.push(char);
      continue;
    }
    if (/\s/.test(char)) {
      if (bufferType !== 'space') flush();
      buffer += char;
      bufferType = 'space';
      continue;
    }
    if (/[\p{L}\p{N}_]/u.test(char)) {
      if (bufferType !== 'word') flush();
      buffer += char;
      bufferType = 'word';
      continue;
    }
    flush();
    tokens.push(char);
  }
  flush();
  return tokens;
}
