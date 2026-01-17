import { TimelyGPTClient } from '@timely/gpt-sdk';
import type { ModelType } from '@timely/gpt-sdk';
import type { ChatMessage } from '../types';

let client: TimelyGPTClient | null = null;

/**
 * SDK 클라이언트 초기화
 */
export function initializeClient(apiKey: string): void {
  client = new TimelyGPTClient({
    apiKey,
    baseURL: 'https://hello.timelygpt.co.kr/api/v2/chat',
  });
}

/**
 * 클라이언트가 초기화되었는지 확인
 */
export function isClientInitialized(): boolean {
  return client !== null;
}

/**
 * 클라이언트 제거
 */
export function destroyClient(): void {
  client = null;
}

/**
 * 스트리밍 메시지 전송
 */
export async function sendMessageStream(
  sessionId: string,
  message: string,
  options: {
    model?: string;
    instructions?: string;
    onToken: (token: string) => void;
    onThinking?: (content: string) => void;
    onComplete: (fullMessage: string) => void;
    onError: (error: Error) => void;
  }
): Promise<void> {
  if (!client) {
    options.onError(new Error('Client not initialized. Please set API Key.'));
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      session_id: sessionId,
      messages: [{ role: 'user', content: message }],
      model: (options.model || 'gpt-4.1') as ModelType,
      instructions: options.instructions || '당신은 친절하고 도움이 되는 AI 어시스턴트입니다. 한국어로 답변해주세요.',
      stream: true,
      locale: 'ko',
    });

    let fullMessage = '';

    for await (const event of stream) {
      switch (event.type) {
        case 'token':
          fullMessage += event.content;
          options.onToken(event.content);
          break;
        case 'thinking':
          if (options.onThinking) {
            options.onThinking(event.content);
          }
          break;
        case 'final_response':
          options.onComplete(fullMessage || event.message);
          break;
        case 'error':
          options.onError(new Error(event.error));
          break;
      }
    }
  } catch (error) {
    options.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 비스트리밍 메시지 전송 (간단한 요청용)
 */
export async function sendMessage(
  sessionId: string,
  message: string,
  options?: {
    model?: string;
    instructions?: string;
  }
): Promise<string> {
  if (!client) {
    throw new Error('Client not initialized. Please set API Key.');
  }

  const response = await client.chat.completions.create({
    session_id: sessionId,
    messages: [{ role: 'user', content: message }],
    model: (options?.model || 'gpt-4.1') as ModelType,
    instructions: options?.instructions || '당신은 친절하고 도움이 되는 AI 어시스턴트입니다. 한국어로 답변해주세요.',
    stream: false,
    locale: 'ko',
  });

  if (response.type === 'final_response') {
    return response.message;
  }

  throw new Error('Unexpected response type');
}

/**
 * 고유 ID 생성
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 새 메시지 객체 생성
 */
export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  isStreaming = false
): ChatMessage {
  return {
    id: generateId(),
    role,
    content,
    timestamp: Date.now(),
    isStreaming,
  };
}
