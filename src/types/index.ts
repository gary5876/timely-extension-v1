/**
 * Timely Chat Types (Simplified)
 * API Key 하나만으로 동작하도록 단순화
 */

export interface ExtensionConfig {
  apiKey: string;
  model: string;
  instructions: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// SDK 관련 타입 (필요시 @timely/gpt-sdk에서 import)
export interface SendMessageOptions {
  sessionId: string;
  message: string;
  model?: string;
  instructions?: string;
  onToken?: (token: string) => void;
  onComplete?: (fullMessage: string) => void;
  onError?: (error: Error) => void;
}
