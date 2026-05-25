/**
 * token 估算(字符近似)。
 * 为什么不用精确 tokenizer:agent 走 openai-compatible 接多家(deepseek/通义…),各家 tokenizer 不同,
 * 精确计数太重。compaction 触发线本就留 buffer(60%),近似足够。
 * 保守策略:中文 ~1 token/字,英文 ~0.3 token/字符,宁可高估(早压缩)不低估(溢出)。
 */
export function estimateTokens(input: unknown): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 1 + other * 0.3);
}
