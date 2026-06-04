import { useEffect, useRef, useState } from 'react';
import {
  BASE_URL_PRESETS,
  type ApiMode,
  type ConnectionDiagnostic,
  hasUnresolvedBaseUrlTemplate,
} from '../../shared/types';
import { useSettingsStore } from '../store/settingsStore';

type TestStatus =
  | { state: 'idle' }
  | { state: 'loading'; message: string }
  | { state: 'success'; message: string; detail?: string }
  | { state: 'error'; message: string; detail?: string };

function buildTestSnapshot(values: {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
}): string {
  return JSON.stringify({
    apiKey: values.apiKey.trim(),
    baseUrl: values.baseUrl.trim(),
    model: values.model.trim(),
    temperature: values.temperature,
    systemPrompt: values.systemPrompt,
  });
}

export default function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, hasKey, save } = useSettingsStore();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [apiMode, setApiMode] = useState<ApiMode>(settings.apiMode);
  const [webSearchEnabled, setWebSearchEnabled] = useState(settings.webSearchEnabled);
  const [saveError, setSaveError] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' });
  const latestTestSnapshot = useRef('');
  const selectedPreset = BASE_URL_PRESETS.find((preset) => preset.baseUrl === baseUrl)?.baseUrl ?? 'custom';

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setTemperature(settings.temperature);
    setSystemPrompt(settings.systemPrompt);
    setApiMode(settings.apiMode);
    setWebSearchEnabled(settings.webSearchEnabled);
  }, [settings]);

  useEffect(() => {
    latestTestSnapshot.current = buildTestSnapshot({
      apiKey,
      baseUrl,
      model,
      temperature,
      systemPrompt,
    });
    setTestStatus((status) => (status.state === 'idle' ? status : { state: 'idle' }));
  }, [apiKey, baseUrl, model, temperature, systemPrompt]);

  const onSave = async () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();

    if (trimmedBaseUrl && hasUnresolvedBaseUrlTemplate(trimmedBaseUrl)) {
      setSaveError('请先把 Base URL 里的 {WorkspaceId} 替换成你的工作空间 ID。');
      return;
    }

    try {
      await save({
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(trimmedModel ? { model: trimmedModel } : {}),
        temperature,
        systemPrompt,
        apiMode,
        webSearchEnabled,
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      });
      setSaveError('');
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const describeDiagnostic = (diagnostic: ConnectionDiagnostic): TestStatus => {
    if (diagnostic.ok) {
      return {
        state: 'success',
        message: diagnostic.message || '连接成功，当前 Key、Base URL 和模型可用。',
        detail: diagnostic.detail,
      };
    }

    return {
      state: 'error',
      message: diagnostic.message,
      detail: diagnostic.detail,
    };
  };

  const onTestConnection = async () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();
    const submittedSnapshot = buildTestSnapshot({
      apiKey,
      baseUrl,
      model,
      temperature,
      systemPrompt,
    });

    if (trimmedBaseUrl && hasUnresolvedBaseUrlTemplate(trimmedBaseUrl)) {
      setTestStatus({
        state: 'error',
        message: '请先把 Base URL 里的 {WorkspaceId} 替换成你的工作空间 ID。',
      });
      return;
    }

    setTestStatus({ state: 'loading', message: '正在测试连接...' });
    try {
      const diagnostic = await window.qwen.testConnection({
        baseUrl: trimmedBaseUrl,
        model: trimmedModel,
        temperature,
        systemPrompt,
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      });
      if (latestTestSnapshot.current !== submittedSnapshot) {
        return;
      }
      setTestStatus(describeDiagnostic(diagnostic));
    } catch (error) {
      if (latestTestSnapshot.current !== submittedSnapshot) {
        return;
      }
      setTestStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-[560px] max-w-[92vw] rounded-2xl bg-[#161a23] border border-white/10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold mb-4">设置</div>

        <label className="block text-sm mb-1 text-white/70">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? '已保存（留空则不修改）' : '填写你的 DashScope API Key'}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">地域 / Base URL</label>
        <select
          value={selectedPreset}
          onChange={(e) => {
            if (e.target.value !== 'custom') {
              setBaseUrl(e.target.value);
            }
          }}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-2"
        >
          {BASE_URL_PRESETS.map((preset) => (
            <option key={preset.baseUrl} value={preset.baseUrl} className="bg-[#161a23]">
              {preset.label}
            </option>
          ))}
          <option value="custom" className="bg-[#161a23]">
            Custom
          </option>
        </select>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-2"
        />
        <p className="text-xs text-white/50 mb-4">
          API Key 必须与 Base URL 地域匹配；Germany Frankfurt 需要把 {'{WorkspaceId}'} 换成你的工作空间 ID。
        </p>

        <label className="block text-sm mb-1 text-white/70">默认模型</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">API Mode</label>
        <select
          value={apiMode}
          onChange={(e) => setApiMode(e.target.value as ApiMode)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-3"
        >
          <option value="chat_completions" className="bg-[#161a23]">
            Chat Completions
          </option>
          <option value="responses" className="bg-[#161a23]">
            Responses
          </option>
        </select>

        <label
          className={`mb-2 flex items-start gap-2 text-sm ${
            apiMode === 'responses' ? 'text-white/75' : 'text-white/35'
          }`}
        >
          <input
            type="checkbox"
            checked={webSearchEnabled}
            onChange={(e) => setWebSearchEnabled(e.target.checked)}
            disabled={apiMode !== 'responses'}
            className="mt-0.5 h-4 w-4 accent-sky-500 disabled:cursor-not-allowed"
          />
          <span>启用 web_search</span>
        </label>
        <p className="text-xs text-white/45 mb-4">
          web_search 会向在线搜索服务发送请求，可能影响响应时间和费用；仅在 Responses 模式下生效。
        </p>

        <label className="block text-sm mb-1 text-white/70">Temperature：{temperature.toFixed(1)}</label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          className="w-full mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4 resize-none"
        />

        {saveError && (
          <div className="mb-4 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 [overflow-wrap:anywhere]">
            {saveError}
          </div>
        )}

        {testStatus.state !== 'idle' && (
          <div
            className={`mb-4 rounded border px-3 py-2 text-sm [overflow-wrap:anywhere] ${
              testStatus.state === 'success'
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                : testStatus.state === 'loading'
                  ? 'border-white/10 bg-white/5 text-white/60'
                  : 'border-red-400/30 bg-red-500/10 text-red-200'
            }`}
          >
            <div>{testStatus.message}</div>
            {'detail' in testStatus && testStatus.detail && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 font-mono text-[11px] leading-relaxed">
                {testStatus.detail}
              </pre>
            )}
          </div>
        )}

        <div className="flex justify-between gap-2">
          <button
            onClick={() => void onTestConnection()}
            disabled={testStatus.state === 'loading'}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testStatus.state === 'loading' ? '测试中...' : '测试连接'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm">
              取消
            </button>
            <button onClick={() => void onSave()} className="px-4 py-2 rounded-lg bg-sky-500/90 hover:bg-sky-500 text-sm">
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
