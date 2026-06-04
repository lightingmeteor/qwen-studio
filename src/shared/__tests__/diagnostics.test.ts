import { describe, expect, it } from 'vitest';
import { classifyDiagnosticError, diagnosticFromStatus } from '../diagnostics';

describe('diagnosticFromStatus', () => {
  it('maps 401 and 403 status codes to auth diagnostics', () => {
    expect(diagnosticFromStatus(401).category).toBe('auth');
    expect(diagnosticFromStatus(403).category).toBe('auth');
  });

  it('maps 400 and 404 status codes to region_or_model diagnostics', () => {
    expect(diagnosticFromStatus(400).category).toBe('region_or_model');
    expect(diagnosticFromStatus(404).category).toBe('region_or_model');
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
