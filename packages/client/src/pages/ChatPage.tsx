import { useState } from 'react';
import { Send, Plus, MessageSquare } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  id: string;
  name: string;
  messages: Message[];
}

export function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([
    { id: '1', name: 'New Chat', messages: [] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('1');
  const [input, setInput] = useState('');

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleNewChat = () => {
    const id = Date.now().toString();
    setSessions((prev) => [{ id, name: 'New Chat', messages: [] }, ...prev]);
    setActiveSessionId(id);
  };

  const handleSend = async () => {
    if (!input.trim() || !activeSession) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, messages: [...s.messages, userMsg] } : s
      )
    );
    setInput('');

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input, sessionId: activeSessionId }),
      });
      const data = await res.json();
      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: data.result || data.error || 'No response' };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId ? { ...s, name: input.slice(0, 30), messages: [...s.messages, assistantMsg] } : s
        )
      );
    } catch {
      const errMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Error connecting to server' };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId ? { ...s, messages: [...s.messages, errMsg] } : s
        )
      );
    }
  };

  return (
    <div className="flex h-full">
      <div className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-3 border-b border-gray-800">
          <button onClick={handleNewChat} className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm">
            <Plus className="w-4 h-4" /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 }
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeSession?.messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-500">
              Send a message to start chatting
            </div>
          )}
          {activeSession?.messages.map((msg) => (
            <div key={msg.id} className={lex }>
              <div className={max-w-2xl px-4 py-2 rounded-lg }>
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-800">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
            <button onClick={handleSend} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white">
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
