import { TimelyGPTClient } from '@timely/gpt-sdk';
import type { ModelType } from '@timely/gpt-sdk';
import type { ChatMessage } from '../types';
import type { ToolCall, ToolResult } from '../types/tools';
import { parseToolCalls, formatToolResultForAI } from './toolParser';
import { executeToolCalls } from './toolExecutor';

let client: TimelyGPTClient | null = null;

// 도구 사용 시스템 프롬프트
const TOOL_SYSTEM_PROMPT = `
당신은 VS Code에서 작동하는 AI 코딩 어시스턴트입니다. 사용자의 프로젝트 파일을 읽고, 쓰고, 편집할 수 있습니다.

## 사용 가능한 도구

1. **read_file**: 파일 내용 읽기
   Parameters: { "path": "파일 경로", "startLine": 시작줄(선택), "endLine": 끝줄(선택) }

2. **write_file**: 새 파일 생성 또는 덮어쓰기
   Parameters: { "path": "파일 경로", "content": "파일 내용" }

3. **edit_file**: 파일의 특정 부분 수정
   Parameters: { "path": "파일 경로", "searchContent": "찾을 내용", "replaceContent": "바꿀 내용" }

4. **list_files**: 디렉토리의 파일 목록 조회
   Parameters: { "directory": "디렉토리 경로(선택)", "pattern": "파일 패턴(선택, 예: **/*.ts)" }

5. **search_files**: 파일 내용 검색
   Parameters: { "query": "검색어", "path": "검색 경로(선택)", "filePattern": "파일 패턴(선택)" }

## 도구 사용 방법

도구를 사용하려면 다음 형식으로 출력하세요:

<tool_call>
<name>도구이름</name>
<parameters>{"key": "value"}</parameters>
</tool_call>

## 핵심 작업 패턴

### 프로젝트 분석 요청 시:
1. 먼저 list_files로 프로젝트 구조 파악 (pattern: "**/*" 또는 "src/**/*")
2. package.json, tsconfig.json 등 설정 파일 읽기
3. 주요 소스 파일들을 순차적으로 읽기
4. 전체 구조와 각 파일의 역할을 종합하여 설명

### 코드 수정 요청 시:
1. 먼저 read_file로 현재 내용 확인
2. edit_file로 정확한 내용 교체 (searchContent는 파일에 정확히 존재해야 함)

### 새 기능 추가 요청 시:
1. 관련 파일들을 먼저 읽어서 기존 패턴 파악
2. 기존 코드 스타일에 맞게 작성

## 중요 규칙

1. **적극적으로 탐색하세요**: 사용자가 "프로젝트 분석", "코드 파악", "구조 설명" 등을 요청하면 스스로 list_files와 read_file을 사용해 프로젝트 전체를 탐색하세요.
2. 파일을 수정하기 전에 반드시 먼저 read_file로 현재 내용을 확인하세요.
3. edit_file의 searchContent는 파일에 정확히 존재하는 내용이어야 합니다.
4. 한 번에 하나의 도구만 호출하세요.
5. 도구 실행 결과를 받은 후 다음 도구를 호출하거나 사용자에게 결과를 설명하세요.
6. 한국어로 답변해주세요.
`;

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
 * 도구 지원 스트리밍 메시지 전송
 * AI가 도구를 호출하면 실행하고 결과를 다시 전달
 */
export async function sendMessageWithTools(
  sessionId: string,
  message: string,
  options: {
    model?: string;
    instructions?: string;
    enableTools?: boolean;
    onToken: (token: string) => void;
    onThinking?: (content: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onToolResult?: (result: ToolResult) => void;
    onComplete: (fullMessage: string) => void;
    onError: (error: Error) => void;
  }
): Promise<void> {
  if (!client) {
    options.onError(new Error('Client not initialized. Please set API Key.'));
    return;
  }

  const enableTools = options.enableTools ?? true;
  const baseInstructions = options.instructions || '';
  const fullInstructions = enableTools
    ? `${TOOL_SYSTEM_PROMPT}\n\n${baseInstructions}`
    : baseInstructions || '당신은 친절하고 도움이 되는 AI 어시스턴트입니다. 한국어로 답변해주세요.';

  let conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: message }
  ];

  let maxIterations = 10; // 무한 루프 방지
  let finalResponse = '';

  while (maxIterations > 0) {
    maxIterations--;

    try {
      const stream = await client.chat.completions.create({
        session_id: sessionId,
        messages: conversationMessages,
        model: (options.model || 'gpt-4.1') as ModelType,
        instructions: fullInstructions,
        stream: true,
        locale: 'ko',
      });

      let currentResponse = '';

      for await (const event of stream) {
        switch (event.type) {
          case 'token':
            currentResponse += event.content;
            options.onToken(event.content);
            break;
          case 'thinking':
            if (options.onThinking) {
              options.onThinking(event.content);
            }
            break;
          case 'final_response':
            currentResponse = currentResponse || event.message;
            break;
          case 'error':
            options.onError(new Error(event.error));
            return;
        }
      }

      // 도구 호출 파싱
      if (enableTools) {
        const parsed = parseToolCalls(currentResponse);

        if (parsed.hasToolCalls) {
          // 텍스트 부분이 있으면 표시
          if (parsed.textContent.trim()) {
            finalResponse += parsed.textContent + '\n';
          }

          // 도구 실행
          const results = await executeToolCalls(parsed.toolCalls, {
            onStart: (toolCall) => {
              options.onToolCall?.(toolCall);
            },
            onComplete: (_toolCall, result) => {
              options.onToolResult?.(result);
            },
          });

          // 도구 결과를 대화에 추가
          const toolResultsText = results.map(formatToolResultForAI).join('\n\n');

          conversationMessages.push({
            role: 'assistant',
            content: currentResponse,
          });
          conversationMessages.push({
            role: 'user',
            content: `도구 실행 결과:\n${toolResultsText}\n\n위 결과를 바탕으로 사용자에게 답변해주세요.`,
          });

          // 다음 반복으로 계속
          continue;
        }
      }

      // 도구 호출이 없으면 완료
      finalResponse += currentResponse;
      options.onComplete(finalResponse);
      return;

    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
  }

  // 최대 반복 도달
  options.onComplete(finalResponse || '작업이 완료되었습니다.');
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

/**
 * 도구 시스템 프롬프트 가져오기
 */
export function getToolSystemPrompt(): string {
  return TOOL_SYSTEM_PROMPT;
}
