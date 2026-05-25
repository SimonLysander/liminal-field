/**
 * splitMessages 纯函数契约测试。
 *
 * 这是对话压缩的关键路径——切错位置会丢对话或压缩到错误边界。
 * 零依赖纯函数，直接断言切分行为。
 */
import { splitMessages } from './compaction.service';

describe('splitMessages', () => {
  const u = (t = '') => ({ role: 'user', content: t });
  const a = (t = '') => ({ role: 'assistant', content: t });

  it('总轮数 > keepRounds：压缩较早的轮，保留最后 keepRounds 轮', () => {
    const msgs = [u('1'), a('1'), u('2'), a('2'), u('3'), a('3')];
    const { toCompact, toKeep } = splitMessages(msgs, 2);
    expect(toCompact).toEqual([u('1'), a('1')]);
    expect(toKeep).toEqual([u('2'), a('2'), u('3'), a('3')]);
  });

  it('总轮数正好等于 keepRounds：全部保留，不压缩', () => {
    const msgs = [u('1'), a('1'), u('2'), a('2')];
    const { toCompact, toKeep } = splitMessages(msgs, 2);
    expect(toCompact).toEqual([]);
    expect(toKeep).toEqual(msgs);
  });

  it('总轮数 < keepRounds：全部保留，不压缩（修复了原先全量压缩的 edge case）', () => {
    const msgs = [u('1'), a('1')];
    const { toCompact, toKeep } = splitMessages(msgs, 8);
    expect(toCompact).toEqual([]);
    expect(toKeep).toEqual(msgs);
  });

  it('空消息：两边都为空', () => {
    const { toCompact, toKeep } = splitMessages([], 8);
    expect(toCompact).toEqual([]);
    expect(toKeep).toEqual([]);
  });

  it('一轮含多条 assistant（连续工具调用）：按 assistant 数计轮，回溯到该轮的 user 起点', () => {
    const msgs = [u('1'), a('1a'), u('2'), a('2a'), a('2b')];
    const { toCompact, toKeep } = splitMessages(msgs, 1);
    expect(toCompact).toEqual([u('1'), a('1a')]);
    expect(toKeep).toEqual([u('2'), a('2a'), a('2b')]);
  });
});
