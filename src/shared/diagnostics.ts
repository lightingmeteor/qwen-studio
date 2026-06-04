import type { ConnectionDiagnostic } from './types';

export function diagnosticFromStatus(status: number, body?: unknown): ConnectionDiagnostic {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      category: 'auth',
      message: 'Authentication failed. Check the API key.',
      detail: detailFromUnknown(body),
    };
  }

  if (status === 400 || status === 404) {
    return {
      ok: false,
      category: 'region_or_model',
      message: 'The Base URL, region, or model name does not look valid for this request.',
      detail: detailFromUnknown(body),
    };
  }

  return {
    ok: false,
    category: 'unknown',
    message: `Connection test failed with HTTP ${status}.`,
    detail: detailFromUnknown(body),
  };
}

export function classifyDiagnosticError(error: unknown): ConnectionDiagnostic {
  const status = statusFromUnknown(error);
  if (status !== undefined) {
    return diagnosticFromStatus(status, bodyFromUnknown(error));
  }

  if (isTimeoutError(error)) {
    return {
      ok: false,
      category: 'timeout',
      message: 'The connection test timed out.',
      detail: detailFromUnknown(error),
    };
  }

  if (error instanceof TypeError) {
    return {
      ok: false,
      category: 'network',
      message: 'A network error prevented the connection test from completing.',
      detail: detailFromUnknown(error),
    };
  }

  return {
    ok: false,
    category: 'unknown',
    message: 'The connection test failed unexpectedly.',
    detail: detailFromUnknown(error),
  };
}

function statusFromUnknown(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.status ?? error.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function bodyFromUnknown(error: unknown): unknown {
  if (!isRecord(error)) {
    return error;
  }

  return error.body ?? error.detail ?? error.message ?? error;
}

function isTimeoutError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const name = typeof error.name === 'string' ? error.name.toLocaleLowerCase() : '';
  const code = typeof error.code === 'string' ? error.code.toLocaleLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLocaleLowerCase() : '';

  return (
    name === 'aborterror' ||
    name.includes('timeout') ||
    code === 'etimedout' ||
    code === 'abort_err' ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
}

function detailFromUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
