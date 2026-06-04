import { useEffect, useState, type KeyboardEvent } from 'react';
import { MODEL_PRESETS } from '../../shared/types';
import { useSettingsStore } from '../store/settingsStore';

export default function ModelSelect(): JSX.Element {
  const { settings, save } = useSettingsStore();
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(settings.model);
  const isPreset = (MODEL_PRESETS as readonly string[]).includes(settings.model);

  useEffect(() => {
    setDraft(settings.model);
  }, [settings.model]);

  const commitDraft = () => {
    const value = draft.trim();
    if (value) void save({ model: value });
    else setDraft(settings.model);
    setCustom(false);
  };

  const onDraftKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(settings.model);
      setCustom(false);
    }
  };

  if (custom || !isPreset) {
    return (
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onDraftKeyDown}
        placeholder="自定义模型名"
        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm w-40"
      />
    );
  }

  return (
    <select
      value={settings.model}
      onChange={(e) => {
        if (e.target.value === '__custom__') {
          setDraft(settings.model);
          setCustom(true);
        } else save({ model: e.target.value });
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
