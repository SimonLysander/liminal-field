export type HeadingNumberingMode = 'none' | 'note' | 'anthology';
export type HeadingNumberingInput = HeadingNumberingMode | null | undefined;

export function getHeadingNumberingClass(
  input: HeadingNumberingInput,
): string {
  if (input === 'note') return 'heading-numbering-note';
  if (input === 'anthology') return 'heading-numbering-anthology';
  return '';
}
