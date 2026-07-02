export const INLINE_ASSIST_EVENT = 'liminal:inline-assist-request';

export type InlineAssistAction =
  | 'open-menu'
  | 'continue'
  | 'make-shorter'
  | 'revise'
  | 'custom';

export interface InlineAssistRequestDetail {
  action: InlineAssistAction;
  editorId: string;
  instruction?: string;
}

export function requestInlineAssist(detail: InlineAssistRequestDetail) {
  window.dispatchEvent(
    new CustomEvent<InlineAssistRequestDetail>(INLINE_ASSIST_EVENT, {
      detail,
    }),
  );
}
