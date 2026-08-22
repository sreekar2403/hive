import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from './router';
import { createDefaultConfig } from './config';
import type { Harness } from '@hive/shared/harness';

const mockHarness: Harness = {
  name: 'test-harness',
  isAvailable: async () => true,
  execute: async () => ({
    success: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
    output: '',
    filesChanged: [],
    duration: 0,
  }),
  isCompatible: () => true,
};

describe('Router', () => {
  let router: Router;
  const config = createDefaultConfig();
  const harnesses = new Map<string, Harness>([
    ['opencode', mockHarness],
    ['claude-code', mockHarness],
    ['pi', mockHarness],
  ]);

  beforeEach(() => {
    router = new Router(config, harnesses);
  });

  describe('heuristicRoute', () => {
    it('routes test-related queries to opencode', () => {
      const result = router.route('write unit tests for this function', ['opencode', 'claude-code']);
      expect(result.harness).toBe('opencode');
      expect(result.reasoning).toContain('Test-related');
    });

    it('routes refactoring queries to claude-code', () => {
      const result = router.route('refactor this code', ['opencode', 'claude-code']);
      expect(result.harness).toBe('claude-code');
      expect(result.reasoning).toContain('Refactoring');
    });

    it('routes documentation queries to claude-code', () => {
      const result = router.route('write documentation for this', ['opencode', 'claude-code']);
      expect(result.harness).toBe('claude-code');
      expect(result.reasoning).toContain('Documentation');
    });

    it('routes devops queries to opencode', () => {
      const result = router.route('set up kubernetes cluster for deployment', ['opencode', 'claude-code']);
      expect(result.harness).toBe('opencode');
      expect(result.reasoning).toContain('DevOps');
    });

    it('uses fallback when no harnesses available', () => {
      const result = router.route('some query', []);
      expect(result.harness).toBe(config.routing.fallback);
      expect(result.reasoning).toContain('No harnesses available');
    });

    it('returns a valid model for the selected harness', () => {
      const result = router.route('any query', ['opencode', 'claude-code']);
      expect(result.model).toBeDefined();
      expect(result.model.length).toBeGreaterThan(0);
    });
  });
});
