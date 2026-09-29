import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger('external-read');
const connectionDocument = z.object({
  'openapi': z.string().startsWith('3.'),
  'x-agent-instructions': z.string().trim().min(1),
});

/** OpenAPI is a raw document, unlike the site's code/msg/data API responses. */
export async function getHttpConnectionInstructions(signal?: AbortSignal): Promise<string> {
  const startedAt = performance.now();
  logger.debug('instructions.fetch_started');
  try {
    const response = await fetch('/api/v1/external/openapi.json', {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal,
    });
    if (!response.ok) throw new Error(`OpenAPI HTTP ${response.status}`);
    const document: unknown = await response.json();
    const parsed = connectionDocument.safeParse(document);
    if (!parsed.success) throw new Error('OpenAPI connection instructions unavailable');
    const instructions = parsed.data['x-agent-instructions'];
    logger.debug('instructions.fetch_completed', {
      durationMs: Math.round(performance.now() - startedAt),
      characters: instructions.length,
    });
    return instructions;
  } catch (error) {
    const context = {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
    if (signal?.aborted) logger.debug('instructions.fetch_cancelled', context);
    else logger.warn('instructions.fetch_failed', context);
    throw error;
  }
}
