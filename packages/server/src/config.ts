export interface Config {
  harnesses: {
    opencode: { enabled: boolean; defaultModel: string };
    'claude-code': { enabled: boolean; defaultModel: string };
    pi: { enabled: boolean; defaultModel: string };
  };
  routing: {
    default: string;
    fallback: string;
  };
  permission: {
    enabled: boolean;
    timeout: number;
    destructiveActions: string[];
  };
  loop: {
    maxIterations: number;
  };
  server: {
    port: number;
  };
  storage: {
    cacheDir: string;
  };
}

export function createDefaultConfig(): Config {
  return {
    harnesses: {
      opencode: { enabled: true, defaultModel: 'claude-sonnet-4' },
      'claude-code': { enabled: true, defaultModel: 'claude-sonnet-4' },
      pi: { enabled: true, defaultModel: 'claude-sonnet-4' },
    },
    routing: {
      default: 'opencode',
      fallback: 'claude-code',
    },
    permission: {
      enabled: true,
      timeout: 60000,
      destructiveActions: [
        'delete',
        'remove',
        'rm',
        'reset',
        'push --force',
        'force-push',
        'clean',
        'prune',
        'push -f',
      ],
    },
    loop: {
      maxIterations: 10,
    },
    server: {
      port: 3001,
    },
    storage: {
      cacheDir: './.hive-cache',
    },
  };
}
