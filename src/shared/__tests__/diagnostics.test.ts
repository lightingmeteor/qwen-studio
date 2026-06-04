import { describe, expect, it } from 'vitest';
import {
  classifyDiagnosticError,
  diagnosticFromStatus,
  sanitizeDiagnosticDetail,
} from '../diagnostics';

describe('sanitizeDiagnosticDetail', () => {
  it('redacts bearer tokens, sk-like keys, authorization headers, and api key fields', () => {
    const detail = sanitizeDiagnosticDetail({
      message: 'Authorization: Bearer sk-live-secret-token failed',
      api_key: 'sk-json-secret-token',
      apiKey: 'sk-camel-secret-token',
      nested: {
        header: 'authorization: Basic abc123',
      },
    });

    expect(detail).toContain('Authorization: [REDACTED]');
    expect(detail).toContain('"api_key":"[REDACTED]"');
    expect(detail).toContain('"apiKey":"[REDACTED]"');
    expect(detail).toContain('authorization: [REDACTED]');
    expect(detail).not.toContain('sk-live-secret-token');
    expect(detail).not.toContain('sk-json-secret-token');
    expect(detail).not.toContain('sk-camel-secret-token');
    expect(detail).not.toContain('abc123');
  });

  it('caps sanitized details after redaction', () => {
    const detail = sanitizeDiagnosticDetail(`sk-${'a'.repeat(60)} ${'x'.repeat(2000)}`, 100);

    expect(detail).toHaveLength(100);
    expect(detail).toContain('[truncated]');
    expect(detail).not.toContain(`sk-${'a'.repeat(60)}`);
  });
});

describe('diagnosticFromStatus', () => {
  it('maps 401 and 403 status codes to auth diagnostics', () => {
    expect(diagnosticFromStatus(401).category).toBe('auth');
    expect(diagnosticFromStatus(403).category).toBe('auth');
  });

  it('maps 400 and 404 status codes to region_or_model diagnostics', () => {
    expect(diagnosticFromStatus(400).category).toBe('region_or_model');
    expect(diagnosticFromStatus(404).category).toBe('region_or_model');
  });

  it('sanitizes upstream response details', () => {
    const diagnostic = diagnosticFromStatus(401, 'Authorization: Bearer sk-upstream-secret');

    expect(diagnostic.detail).toBe('Authorization: [REDACTED]');
    expect(diagnostic.detail).not.toContain('sk-upstream-secret');
  });
});

describe('classifyDiagnosticError', () => {
  it('maps response-like HTTP status errors', () => {
    expect(classifyDiagnosticError({ status: 401 }).category).toBe('auth');
    expect(classifyDiagnosticError({ status: 404, body: 'model not found' }).category).toBe(
      'region_or_model',
    );
  });

  it('maps abort and timeout-shaped errors to timeout', () => {
    expect(classifyDiagnosticError(new DOMException('Timed out', 'AbortError')).category).toBe(
      'timeout',
    );
    expect(classifyDiagnosticError(new Error('Request timeout after 30s')).category).toBe('timeout');
  });

  it('maps TypeError failures to network', () => {
    expect(classifyDiagnosticError(new TypeError('fetch failed')).category).toBe('network');
  });

  it('falls back to unknown for unrecognized errors', () => {
    expect(classifyDiagnosticError(new Error('unexpected failure'))).toMatchObject({
      ok: false,
      category: 'unknown',
    });
  });
});
