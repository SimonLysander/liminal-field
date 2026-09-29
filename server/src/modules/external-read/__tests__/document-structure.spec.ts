import {
  documentStructure,
  isAssetName,
  markdownPage,
} from '../document-structure';

describe('Public Markdown structure', () => {
  it('preserves original offsets, preamble and nested section boundaries', () => {
    const markdown =
      'Introduction\r\n\r\n# One\r\n\r\nBody\r\n\r\n## Detail\r\n\r\n$k \\times x$\r\n\r\n# Two\r\n';
    const { sections } = documentStructure(markdown);
    expect(sections.map((section) => [section.title, section.level])).toEqual([
      ['', 0],
      ['One', 1],
      ['Detail', 2],
      ['Two', 1],
    ]);
    expect(markdown.slice(sections[1].start, sections[1].end)).toContain(
      '## Detail',
    );
    expect(markdown.slice(sections[2].start, sections[2].end)).toBe(
      '## Detail\r\n\r\n$k \\times x$\r\n\r\n',
    );
  });
  it('detects real Markdown and HTML media, not code examples or unsafe names', () => {
    const markdown =
      '![Photo](./assets/photo%20one.png)\n\n[Data](./assets/data.json)\n\n<audio src="./assets/voice.mp3"></audio>\n\n```md\n# Fake\n![Private](./assets/private.png)\n```\n\n![Bad](./assets/..%2Fsecret.png)';
    expect(
      documentStructure(markdown).assets.map((asset) => asset.fileName),
    ).toEqual(['photo one.png', 'data.json', 'voice.mp3']);
    expect(documentStructure(markdown).sections).toEqual([]);
    for (const name of ['..', '.', '../secret', 'a\\b', '\u0000', ''])
      expect(isAssetName(name)).toBe(false);
  });
  it('paginates losslessly, including oversized blocks and Unicode boundaries', () => {
    const markdown = 'First paragraph\n\n' + '文😀'.repeat(1000) + '\n\nFinal';
    let offset = 0;
    let reconstructed = '';
    const { boundaries } = documentStructure(markdown);
    while (offset < markdown.length) {
      const page = markdownPage(markdown, offset, 1000, boundaries);
      expect(page.end).toBeGreaterThan(offset);
      expect(page.markdown).not.toMatch(/[\uD800-\uDBFF]$/);
      reconstructed += page.markdown;
      offset = page.end;
    }
    expect(reconstructed).toBe(markdown);
  });
});
