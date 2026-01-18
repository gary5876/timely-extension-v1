/**
 * Timely Chat Types (Simplified)
 * API Key 하나만으로 동작하도록 단순화
 */

import type { ToolCall, ToolResult } from './tools';

export interface ExtensionConfig {
  apiKey: string;
  model: string;
  instructions: string;
  enableFileOperations?: boolean;
  fileOperationAutoApply?: boolean;
  blockedFilePatterns?: string[];
  maxFileReadSize?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  // 도구 관련 필드
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  filePath?: string;
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
  enableTools?: boolean;
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onComplete?: (fullMessage: string) => void;
  onError?: (error: Error) => void;
}

// Re-export tool types for convenience
export type { ToolCall, ToolResult } from './tools';
