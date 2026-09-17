import {
  AI_RUNTIME_LIMITS,
  resolveModelMaxTokens,
  resolveSubAgentSteps,
} from '../ai-runtime-limits';

describe('ai-runtime-limits', () => {
  it('uses the configured output ceiling without exceeding the context window', () => {
    expect(resolveModelMaxTokens(32_000)).toBe(32_000);
    expect(resolveModelMaxTokens(1_000_000)).toBe(
      AI_RUNTIME_LIMITS.maxOutputTokens,
    );
  });

  it('normalizes sub-agent step requests to the documented safety range', () => {
    expect(resolveSubAgentSteps()).toBe(AI_RUNTIME_LIMITS.subAgentDefaultSteps);
    expect(resolveSubAgentSteps(0)).toBe(1);
    expect(resolveSubAgentSteps(10_000)).toBe(
      AI_RUNTIME_LIMITS.subAgentMaxSteps,
    );
  });
});
