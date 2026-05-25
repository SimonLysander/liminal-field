/**
 * sliceSessionPage 分页纯函数单测。
 *
 * 覆盖场景：
 * 1. 无 before：返回最近 limit 条，hasMore=true（总量 > limit）
 * 2. 无 before：总量 <= limit 时 hasMore=false
 * 3. 有 before：从 before index 前取 limit 条
 * 4. before 导致 startIdx=0：hasMore=false（已到最早）
 * 5. before=0：messages 为空，hasMore=false
 * 6. 空数组：messages 为空，hasMore=false
 * 7. 正序保持：返回消息顺序与入参一致
 */
import { sliceSessionPage } from './session-pagination';

function mkMsgs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: 'user',
    content: `msg${i}`,
  }));
}

describe('sliceSessionPage', () => {
  it('无 before，总量 > limit：返回最近 limit 条，hasMore=true', () => {
    const msgs = mkMsgs(10);
    const page = sliceSessionPage(msgs, undefined, 3);

    expect(page.messages).toHaveLength(3);
    expect(page.messages[0].content).toBe('msg7');
    expect(page.messages[2].content).toBe('msg9');
    expect(page.hasMore).toBe(true);
    expect(page.firstIndex).toBe(7);
  });

  it('无 before，总量 <= limit：返回全部，hasMore=false', () => {
    const msgs = mkMsgs(5);
    const page = sliceSessionPage(msgs, undefined, 10);

    expect(page.messages).toHaveLength(5);
    expect(page.hasMore).toBe(false);
    expect(page.firstIndex).toBe(0);
  });

  it('有 before=7 limit=3：返回 msg4/msg5/msg6', () => {
    const msgs = mkMsgs(10);
    const page = sliceSessionPage(msgs, 7, 3);

    expect(page.messages).toHaveLength(3);
    expect(page.messages[0].content).toBe('msg4');
    expect(page.messages[2].content).toBe('msg6');
    expect(page.firstIndex).toBe(4);
    expect(page.hasMore).toBe(true);
  });

  it('before=3 limit=5：startIdx=0，hasMore=false（已到最早）', () => {
    const msgs = mkMsgs(10);
    // endIdx=3，startIdx=max(0,3-5)=0
    const page = sliceSessionPage(msgs, 3, 5);

    expect(page.firstIndex).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.messages).toHaveLength(3); // slice(0,3)=msg0/1/2
  });

  it('before=0：messages 为空，hasMore=false', () => {
    const msgs = mkMsgs(10);
    const page = sliceSessionPage(msgs, 0, 5);

    expect(page.messages).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.firstIndex).toBe(0);
  });

  it('空数组：messages 为空，hasMore=false', () => {
    const page = sliceSessionPage([], undefined, 10);

    expect(page.messages).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.firstIndex).toBe(0);
  });

  it('before 超过 total：等效于无 before（before=total）', () => {
    const msgs = mkMsgs(5);
    // before=100 > total=5 → endIdx=min(100,5)=5
    const page = sliceSessionPage(msgs, 100, 3);

    expect(page.messages).toHaveLength(3); // msg2/3/4
    expect(page.messages[0].content).toBe('msg2');
    expect(page.hasMore).toBe(true);
    expect(page.firstIndex).toBe(2);
  });
});
