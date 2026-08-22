// Client -> Server messages
export interface QuerySubmit {
  type: 'query:submit';
  payload: { query: string; sessionId?: string };
  id: string;
  timestamp: number;
}

export interface QueryCancel {
  type: 'query:cancel';
  payload: { sessionId: string };
  id: string;
  timestamp: number;
}

export interface SessionCreate {
  type: 'session:create';
  payload: { name?: string };
  id: string;
  timestamp: number;
}

export interface SessionDelete {
  type: 'session:delete';
  payload: { sessionId: string };
  id: string;
  timestamp: number;
}

export interface PermissionReply {
  type: 'permission:reply';
  payload: {
    requestId: string;
    sessionId: string;
    approved: boolean;
    reason?: string;
  };
  id: string;
  timestamp: number;
}

export interface SettingsUpdate {
  type: 'settings:update';
  payload: { settings: Record<string, unknown> };
  id: string;
  timestamp: number;
}

export type ClientMessage =
  | QuerySubmit
  | QueryCancel
  | SessionCreate
  | SessionDelete
  | PermissionReply
  | SettingsUpdate;

// Server -> Client messages
export interface ChatMessage {
  type: 'chat:message';
  sessionId: string;
  payload: {
    role: 'user' | 'assistant' | 'system';
    content: string;
  };
  id: string;
  timestamp: number;
}

export interface SessionDone {
  type: 'session:done';
  sessionId: string;
  payload: {
    success: boolean;
    summary: string;
    filesChanged?: string[];
    iterations?: number;
  };
  id: string;
  timestamp: number;
}

export interface SessionError {
  type: 'session:error';
  sessionId: string;
  payload: {
    error: string;
    details?: string;
  };
  id: string;
  timestamp: number;
}

export interface IterationStart {
  type: 'iteration:start';
  sessionId: string;
  payload: {
    iteration: number;
    prompt: string;
  };
  id: string;
  timestamp: number;
}

export interface IterationComplete {
  type: 'iteration:complete';
  sessionId: string;
  payload: {
    iteration: number;
    success: boolean;
    output?: string;
    filesChanged?: string[];
  };
  id: string;
  timestamp: number;
}

export interface PermissionRequest {
  type: 'permission:request';
  sessionId: string;
  payload: {
    requestId: string;
    action: string;
    description: string;
    command?: string;
    files?: string[];
  };
  id: string;
  timestamp: number;
}

export interface SessionList {
  type: 'session:list';
  payload: {
    sessions: Array<{ id: string; name: string; createdAt: number }>;
  };
  id: string;
  timestamp: number;
}

export interface Ready {
  type: 'ready';
  payload: {
    harnesses: Array<{ name: string; available: boolean }>;
  };
  id: string;
  timestamp: number;
}

export type ServerMessage =
  | ChatMessage
  | SessionDone
  | SessionError
  | IterationStart
  | IterationComplete
  | PermissionRequest
  | SessionList
  | Ready;
