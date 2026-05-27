import { computeBodyHash } from '../body-hash.utils';

describe('computeBodyHash', () => {
  it('同一 input 始终产出同一 hash', () => {
    const a = computeBodyHash('独处并不可怕。');
    const b = computeBodyHash('独处并不可怕。');
    expect(a).toBe(b);
  });

  it('不同 input 产出不同 hash', () => {
    const a = computeBodyHash('独处并不可怕。');
    const b = computeBodyHash('独处也许并不可怕。');
    expect(a).not.toBe(b);
  });

  it('hash 长度 = 16 字符(64bit hex)', () => {
    const h = computeBodyHash('任意内容');
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('空字符串也能算出固定 hash', () => {
    const h = computeBodyHash('');
    expect(h).toHaveLength(16);
    expect(h).toBe('e3b0c44298fc1c14'); // sha256('') 前 16 字符
  });

  it('utf8 编码:中文字符与 latin-1 不同', () => {
    const cn = computeBodyHash('字');
    expect(cn).not.toBe(computeBodyHash('?'));
  });
});
