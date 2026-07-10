type LogLevel = 'debug' | 'warn' | 'error';
type LogContext = Readonly<Record<string, unknown>>;

type LogRecord = {
  scope: string;
  level: LogLevel;
  event: string;
  context: LogContext;
};

export type Logger = {
  debug: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
  error: (event: string, context?: LogContext) => void;
};

function createRecord(
  scope: string,
  level: LogLevel,
  event: string,
  context: LogContext = {},
): LogRecord {
  return { scope, level, event, context };
}

export function createLogger(scope: string): Logger {
  return {
    debug(event, context) {
      if (!import.meta.env.DEV) return;
      console.debug(createRecord(scope, 'debug', event, context));
    },
    warn(event, context) {
      console.warn(createRecord(scope, 'warn', event, context));
    },
    error(event, context) {
      console.error(createRecord(scope, 'error', event, context));
    },
  };
}
