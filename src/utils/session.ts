import * as vscode from 'vscode';
import type { ChatMessage, ChatSession } from '../types';

const SESSIONS_KEY = 'timelyChat.sessions';
const ACTIVE_SESSION_KEY = 'timelyChat.activeSessionId';

/**
 * 고유 세션 ID 생성
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 모든 세션 가져오기
 */
export function getAllSessions(context: vscode.ExtensionContext): Map<string, ChatSession> {
  const sessions = context.globalState.get<Record<string, ChatSession>>(SESSIONS_KEY) || {};
  return new Map(Object.entries(sessions));
}

/**
 * 특정 세션 가져오기
 */
export function getSession(context: vscode.ExtensionContext, sessionId: string): ChatSession | undefined {
  const sessions = getAllSessions(context);
  return sessions.get(sessionId);
}

/**
 * 새 세션 생성
 */
export function createNewSession(context: vscode.ExtensionContext): ChatSession {
  const sessionId = generateSessionId();
  const session: ChatSession = {
    id: sessionId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const sessions = context.globalState.get<Record<string, ChatSession>>(SESSIONS_KEY) || {};
  sessions[sessionId] = session;
  context.globalState.update(SESSIONS_KEY, sessions);

  return session;
}

/**
 * 세션 메시지 저장
 */
export async function saveSessionMessages(
  context: vscode.ExtensionContext,
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  const sessions = context.globalState.get<Record<string, ChatSession>>(SESSIONS_KEY) || {};

  if (sessions[sessionId]) {
    sessions[sessionId].messages = messages;
    sessions[sessionId].updatedAt = Date.now();
  } else {
    sessions[sessionId] = {
      id: sessionId,
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  await context.globalState.update(SESSIONS_KEY, sessions);
}

/**
 * 세션 메시지 로드
 */
export function loadSessionMessages(context: vscode.ExtensionContext, sessionId: string): ChatMessage[] {
  const session = getSession(context, sessionId);
  return session?.messages || [];
}

/**
 * 특정 세션 삭제
 */
export async function deleteSession(context: vscode.ExtensionContext, sessionId: string): Promise<void> {
  const sessions = context.globalState.get<Record<string, ChatSession>>(SESSIONS_KEY) || {};
  delete sessions[sessionId];
  await context.globalState.update(SESSIONS_KEY, sessions);
}

/**
 * 모든 세션 클리어
 */
export async function clearAllSessions(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(SESSIONS_KEY, {});
  await context.globalState.update(ACTIVE_SESSION_KEY, null);
}

// 레거시 호환성을 위한 함수들
export function getSessionId(context: vscode.ExtensionContext): string {
  let sessionId = context.globalState.get<string>(ACTIVE_SESSION_KEY);
  if (!sessionId) {
    const session = createNewSession(context);
    sessionId = session.id;
    context.globalState.update(ACTIVE_SESSION_KEY, sessionId);
  }
  return sessionId;
}

export function startNewSession(context: vscode.ExtensionContext): string {
  const session = createNewSession(context);
  context.globalState.update(ACTIVE_SESSION_KEY, session.id);
  return session.id;
}

export async function clearSession(context: vscode.ExtensionContext): Promise<void> {
  await clearAllSessions(context);
}
