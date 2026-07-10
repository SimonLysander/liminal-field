export type CodeLanguage = {
  label: string;
  value: string;
};

export const codeLanguages: readonly CodeLanguage[] = [
  { label: 'Plain Text', value: 'plaintext' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Java', value: 'java' },
  { label: 'Python', value: 'python' },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'Shell', value: 'bash' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
  { label: 'SQL', value: 'sql' },
  { label: 'JSON', value: 'json' },
  { label: 'YAML', value: 'yaml' },
  { label: 'Markdown', value: 'markdown' },
];

export function getCodeLanguageLabel(value: string): string {
  return codeLanguages.find((language) => language.value === value)?.label ??
    (value !== 'plaintext' ? value : '');
}
