import type { ChatReferenceSnapshot } from '@/pages/admin/lib/live-chat-selection';

export interface EditSession {
  id: string;
  targets: ChatReferenceSnapshot[];
  source: 'references' | 'tool';
  updatedAt: number;
}

export class ReferenceRegistry {
  private readonly references = new Map<string, ChatReferenceSnapshot>();

  registerMany(references: ChatReferenceSnapshot[] | undefined) {
    for (const reference of references ?? []) {
      this.references.set(reference.id, reference);
    }
  }

  get(id: string | undefined): ChatReferenceSnapshot | undefined {
    if (!id) return undefined;
    return this.references.get(id);
  }

  getMany(ids: string[]): ChatReferenceSnapshot[] {
    return ids
      .map((id) => this.references.get(id))
      .filter((ref): ref is ChatReferenceSnapshot => Boolean(ref));
  }

  hydrateFromMessages(messages: Array<{ metadata?: unknown }>) {
    for (const message of messages) {
      const refs = getMessageReferences(message.metadata);
      this.registerMany(refs);
    }
  }
}

export function createEditSession(
  targets: ChatReferenceSnapshot[],
  source: EditSession['source'],
): EditSession | undefined {
  if (targets.length === 0) return undefined;
  return {
    id: `edit-${targets.map((target) => target.id).join('-')}-${Date.now()}`,
    targets,
    source,
    updatedAt: Date.now(),
  };
}

export function isEditConfirmation(text: string): boolean {
  const normalized = text.trim();
  return /^(换|换吧|替换|应用|应用吧|用这个|就用这个|改成这个|换成这个|接受|确认|可以|好|好啊|行|行吧)[。！？!,.，\s]*$/.test(
    normalized,
  );
}

export function isReferenceEditRequest(text: string): boolean {
  return /(润色|改写|修改|修正|删掉|删除|替换|换成|改成|直接改|处理这|应用|用这个)/.test(
    text,
  );
}

export function getMessageReferences(metadata: unknown): ChatReferenceSnapshot[] {
  const refs = (metadata as { references?: unknown } | undefined)?.references;
  if (!Array.isArray(refs)) return [];
  return refs.filter((ref): ref is ChatReferenceSnapshot => {
    return (
      typeof ref === 'object' &&
      ref !== null &&
      typeof (ref as ChatReferenceSnapshot).id === 'string' &&
      typeof (ref as ChatReferenceSnapshot).order === 'number' &&
      typeof (ref as ChatReferenceSnapshot).text === 'string' &&
      typeof (ref as ChatReferenceSnapshot).preview === 'string' &&
      typeof (ref as ChatReferenceSnapshot).anchor === 'object' &&
      (ref as ChatReferenceSnapshot).anchor !== null
    );
  });
}
