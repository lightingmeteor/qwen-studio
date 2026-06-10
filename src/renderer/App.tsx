import { lazy, Suspense, useEffect, useState } from 'react';
import { useChatStore, initChatBridge } from './store/chatStore';
import { useSettingsStore } from './store/settingsStore';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';

const SettingsDialog = lazy(() => import('./components/SettingsDialog'));

export default function App(): JSX.Element {
  const [showSettings, setShowSettings] = useState(false);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadSettings = useSettingsStore((s) => s.load);
  const hasKey = useSettingsStore((s) => s.hasKey);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    initChatBridge();
    void loadSettings();
    void loadConversations();
  }, [loadConversations, loadSettings]);

  // First run with no key: open settings automatically.
  useEffect(() => {
    if (loaded && !hasKey) setShowSettings(true);
  }, [loaded, hasKey]);

  return (
    <div className="h-full flex">
      <Sidebar onOpenSettings={() => setShowSettings(true)} />
      <ChatPage onOpenSettings={() => setShowSettings(true)} />
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
    </div>
  );
}
