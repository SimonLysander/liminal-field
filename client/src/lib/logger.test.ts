// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('createLogger', () => {
  it('adds scope and level to structured warn and error records', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger('document-markdown');

    logger.warn('parse_slow', { durationMs: 120 });
    logger.error('parse_failed', { errorType: 'Error' });

    expect(warnSpy).toHaveBeenCalledWith({
      scope: 'document-markdown',
      level: 'warn',
      event: 'parse_slow',
      context: { durationMs: 120 },
    });
    expect(errorSpy).toHaveBeenCalledWith({
      scope: 'document-markdown',
      level: 'error',
      event: 'parse_failed',
      context: { errorType: 'Error' },
    });
  });

  it('emits structured debug records in development', () => {
    vi.stubEnv('DEV', true);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const logger = createLogger('document-markdown');

    logger.debug('parse_started', { markdownLength: 42 });

    expect(debugSpy).toHaveBeenCalledWith({
      scope: 'document-markdown',
      level: 'debug',
      event: 'parse_started',
      context: { markdownLength: 42 },
    });
  });

  it('does not emit debug records in production', () => {
    vi.stubEnv('DEV', false);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const logger = createLogger('document-markdown');

    logger.debug('parse_started', { markdownLength: 42 });

    expect(debugSpy).not.toHaveBeenCalled();
  });
});
