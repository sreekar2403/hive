import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Bot, User, Loader2, AlertCircle } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  taskId?: string;
  status?: string;
  timestamp: number;
}

interface Session {
  id: string;
  messages: Message[];
}

export function ChatInterface() {
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [sessions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = `session_${Date.now()}`;
      setCurrentSessionId(sessionId);
      setSessions((prev) => {
        const newMap = new Map(prev);
        newMap.set(sessionId, { id: sessionId, messages: [] });
        return newMap;
      });
    }

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setSessions((prev) => {
      const newMap = new Map(prev);
      const session = newMap.get(sessionId)!;
      newMap.set(sessionId, {
        ...session,
        messages: [...session.messages, userMessage],
      });
      return newMap;
    });

    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, sessionId }),
      });

      const data = await response.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.output || data.error || 'No response',
        taskId: data.taskId,
        status: data.status,
        timestamp: Date.now(),
      };

      setSessions((prev) => {
        const newMap = new Map(prev);
        const session = newMap.get(sessionId)!;
        newMap.set(sessionId, {
          ...session,
          messages: [...session.messages, assistantMessage],
        });
        return newMap;
      });
    } catch (err) {
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Error: Failed to connect to server',
        timestamp: Date.now(),
      };

      setSessions((prev) => {
        const newMap = new Map(prev);
        const session = newMap.get(sessionId)!;
        newMap.set(sessionId, {
          ...session,
          messages: [...session.messages, errorMessage],
        });
        return newMap;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800 bg-gray-900">
        <MessageCircle className="w-6 h-6 text-blue-400" />
        <h1 className="text-xl font-bold">Hive - Swarm Agent Chat</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {sessions.size === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Bot className="w-16 h-16 mb-4" />
            <p className="text-lg">Start a conversation with the swarm</p>
          </div>
        )}

        {Array.from(sessions.entries()).map(([sid, session]) =>
          session.messages.map((msg, idx) => (
            <div
              key={`${sid}-${idx}`}
              className={`flex items-start gap-3 ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              )}

              <div
                className={`max-w-2xl px-4 py-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-100'
                }`}
              >
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                {msg.status && (
                  <div className="mt-2 text-xs text-gray-400">
                    Status: {msg.status}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
            <div className="bg-gray-800 px-4 py-3 rounded-2xl">
              <span className="text-gray-400 text-sm">Processing...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-800 bg-gray-900"
      >
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the swarm to do work..."
            className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatInterface;
