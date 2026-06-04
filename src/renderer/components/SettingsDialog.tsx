import { useEffect, useState } from 'react';
import { BASE_URL_PRESETS } from '../../shared/types';
import { useSettingsStore } from '../store/settingsStore';

export default function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, hasKey, save } = useSettingsStore();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [saveError, setSaveError] = useState('');
  const selectedPreset = BASE_URL_PRESETS.find((preset) => preset.baseUrl === baseUrl)?.baseUrl ?? 'custom';

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setTemperature(settings.temperature);
    setSystemPrompt(settings.systemPrompt);
  }, [settings]);

  const onSave = async () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();

    try {
      await save({
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(trimmedModel ? { model: trimmedModel } : {}),
        temperature,
        systemPrompt,
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      });
      setSaveError('');
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
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
        <p className="text-xs text-white/50 mb-4">API Key 必须与 Base URL 地域匹配；非中国大陆 key 请切换到对应地域。</p>

        <label className="block text-sm mb-1 text-white/70">默认模型</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

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

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm">
            取消
          </button>
          <button onClick={() => void onSave()} className="px-4 py-2 rounded-lg bg-sky-500/90 hover:bg-sky-500 text-sm">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
