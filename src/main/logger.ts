import { sanitizeDiagnosticDetail } from '../shared/diagnostics';

type LogLevel = 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

const SECRET_FIELD_PATTERN = /api[_-]?key|authorization|token|secret/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return sanitizeDiagnosticDetail(value, 300) ?? '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeDiagnosticDetail(value.message, 300) ?? '',
    };
  }
  if (depth >= 3) return '[MaxDepth]';

  if (Array.isArray(value)) {
    return value.map((item) => safeValue(item, seen, depth + 1));
  }
  if (isRecord(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_FIELD_PATTERN.test(key) ? '[REDACTED]' : safeValue(item, seen, depth + 1),
      ]),
    );
  }

  return sanitizeDiagnosticDetail(String(value), 300) ?? '';
}

function safeFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      SECRET_FIELD_PATTERN.test(key) ? '[REDACTED]' : safeValue(value),
    ]),
  );
}

function writeLog(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = `[QwenStudio] ${new Date().toISOString()} ${level.toUpperCase()} ${event}`;
  const payload = safeFields(fields);
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;

  if (Object.keys(payload).length > 0) {
    method(line, payload);
    return;
  }

  method(line);
}

export function logInfo(event: string, fields?: LogFields): void {
  writeLog('info', event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  writeLog('warn', event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  writeLog('error', event, fields);
}
