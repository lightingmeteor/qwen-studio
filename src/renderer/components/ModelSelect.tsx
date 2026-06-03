import { useState } from 'react';
import { MODEL_PRESETS } from '../../shared/types';
import { useSettingsStore } from '../store/settingsStore';

export default function ModelSelect(): JSX.Element {
  const { settings, save } = useSettingsStore();
  const [custom, setCustom] = useState(false);
  const isPreset = (MODEL_PRESETS as readonly string[]).includes(settings.model);

  if (custom || !isPreset) {
    return (
      <input
        value={settings.model}
        onChange={(e) => save({ model: e.target.value })}
        onBlur={() => setCustom(false)}
        placeholder="自定义模型名"
        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm w-40"
      />
    );
  }

  return (
    <select
      value={settings.model}
      onChange={(e) => {
        if (e.target.value === '__custom__') setCustom(true);
        else save({ model: e.target.value });
      }}
      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm"
    >
      {MODEL_PRESETS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value="__custom__">自定义…</option>
    </select>
  );
}
