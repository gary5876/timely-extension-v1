import * as vscode from 'vscode';

export interface ChatMessage {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    fileName?: string;
    language?: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const HISTORY_KEY = 'timelyChat.history';
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 100;

/**
 * Get all chat sessions from storage
 */
export async function getChatSessions(context: vscode.ExtensionContext): Promise<ChatSession[]> {
  const sessions = context.globalState.get<ChatSession[]>(HISTORY_KEY, []);
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get a specific chat session by ID
 */
export async function getChatSession(
  context: vscode.ExtensionContext,
  sessionId: string
): Promise<ChatSession | undefined> {
  const sessions = await getChatSessions(context);
  return sessions.find(s => s.id === sessionId);
}

/**
 * Create a new chat session
 */
export async function createChatSession(
  context: vscode.ExtensionContext,
  title?: string
): Promise<ChatSession> {
  const sessions = await getChatSessions(context);

  const newSession: ChatSession = {
    id: generateId(),
    title: title || `Chat ${new Date().toLocaleDateString()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };

  // Keep only the most recent sessions
  const updatedSessions = [newSession, ...sessions].slice(0, MAX_SESSIONS);
  await context.globalState.update(HISTORY_KEY, updatedSessions);

  return newSession;
}

/**
 * Add a message to a chat session
 */
export async function addMessageToSession(
  context: vscode.ExtensionContext,
  sessionId: string,
  message: Omit<ChatMessage, 'id' | 'timestamp'>
): Promise<void> {
  const sessions = await getChatSessions(context);
  const sessionIndex = sessions.findIndex(s => s.id === sessionId);

  if (sessionIndex === -1) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const newMessage: ChatMessage = {
    ...message,
    id: generateId(),
    timestamp: Date.now(),
  };

  sessions[sessionIndex].messages.push(newMessage);
  sessions[sessionIndex].updatedAt = Date.now();

  // Keep only the most recent messages
  if (sessions[sessionIndex].messages.length > MAX_MESSAGES_PER_SESSION) {
    sessions[sessionIndex].messages = sessions[sessionIndex].messages.slice(-MAX_MESSAGES_PER_SESSION);
  }

  await context.globalState.update(HISTORY_KEY, sessions);
}

/**
 * Update session title
 */
export async function updateSessionTitle(
  context: vscode.ExtensionContext,
  sessionId: string,
  title: string
): Promise<void> {
  const sessions = await getChatSessions(context);
  const sessionIndex = sessions.findIndex(s => s.id === sessionId);

  if (sessionIndex === -1) {
    throw new Error(`Session ${sessionId} not found`);
  }

  sessions[sessionIndex].title = title;
  sessions[sessionIndex].updatedAt = Date.now();

  await context.globalState.update(HISTORY_KEY, sessions);
}

/**
 * Delete a chat session
 */
export async function deleteChatSession(
  context: vscode.ExtensionContext,
  sessionId: string
): Promise<void> {
  const sessions = await getChatSessions(context);
  const updatedSessions = sessions.filter(s => s.id !== sessionId);
  await context.globalState.update(HISTORY_KEY, updatedSessions);
}

/**
 * Clear all chat history
 */
export async function clearAllHistory(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(HISTORY_KEY, []);
}

/**
 * Export chat history as JSON
 */
export async function exportHistory(context: vscode.ExtensionContext): Promise<string> {
  const sessions = await getChatSessions(context);
  return JSON.stringify(sessions, null, 2);
}

/**
 * Import chat history from JSON
 */
export async function importHistory(
  context: vscode.ExtensionContext,
  json: string
): Promise<void> {
  try {
    const sessions = JSON.parse(json) as ChatSession[];

    // Validate the imported data
    if (!Array.isArray(sessions)) {
      throw new Error('Invalid format: Expected an array of sessions');
    }

    for (const session of sessions) {
      if (!session.id || !session.title || !Array.isArray(session.messages)) {
        throw new Error('Invalid session format');
      }
    }

    await context.globalState.update(HISTORY_KEY, sessions);
  } catch (error) {
    throw new Error(`Failed to import history: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
