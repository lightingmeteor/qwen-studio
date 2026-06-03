import { useChatStore } from '../store/chatStore';

const PROMPTS = [
  '你好，请用一句话介绍你自己',
  '用 Python 写一个快速排序，并解释思路',
  '把下面这段话翻译成英文：今天天气很好',
  '给我三个周末适合做的小项目点子',
];

export default function WelcomeState(): JSX.Element {
  const sendMessage = useChatStore((s) => s.sendMessage);
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-2xl font-semibold mb-2">欢迎使用 Qwen Studio Desktop</div>
      <div className="text-white/50 mb-8">挑一个开始，或直接在下面输入框提问。</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => void sendMessage(p)}
            className="text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-4 text-sm"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
