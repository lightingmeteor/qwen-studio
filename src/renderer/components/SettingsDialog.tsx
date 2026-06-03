import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';

export default function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, hasKey, save } = useSettingsStore();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setTemperature(settings.temperature);
    setSystemPrompt(settings.systemPrompt);
  }, [settings]);

  const onSave = async () => {
    await save({
      baseUrl,
      model,
      temperature,
      systemPrompt,
      ...(apiKey ? { apiKey } : {}),
    });
    onClose();
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

        <label className="block text-sm mb-1 text-white/70">Base URL</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

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
