import { TimelyGPTClient } from '@timely/gpt-sdk';
import type { ModelType } from '@timely/gpt-sdk';
import type { ChatMessage } from '../types';
import type { ToolCall, ToolResult } from '../types/tools';
import { parseToolCalls, formatToolResultForAI } from './toolParser';
import { executeToolCalls } from './toolExecutor';

let client: TimelyGPTClient | null = null;

// 도구 사용 시스템 프롬프트
const TOOL_SYSTEM_PROMPT = `
당신은 VS Code에서 작동하는 AI 코딩 어시스턴트입니다. 사용자의 프로젝트 파일을 읽고, 쓰고, 편집하고, **검색**할 수 있습니다.

## 사용 가능한 도구

1. **read_file**: 파일 내용 읽기
   Parameters: { "path": "파일 경로", "startLine": 시작줄(선택), "endLine": 끝줄(선택) }

2. **write_file**: 새 파일 생성 또는 덮어쓰기
   Parameters: { "path": "파일 경로", "content": "파일 내용" }

3. **edit_file**: 파일의 특정 부분 수정
   Parameters: { "path": "파일 경로", "searchContent": "찾을 내용", "replaceContent": "바꿀 내용" }

4. **list_files**: 디렉토리의 파일 목록 조회
   Parameters: { "directory": "디렉토리 경로(선택)", "pattern": "파일 패턴(선택, 예: **/*.ts)" }

5. **search_files**: 파일 내용 검색 (코드에서 특정 키워드/함수/변수 찾기)
   Parameters: { "query": "검색어", "path": "검색 경로(선택)", "filePattern": "파일 패턴(선택)" }

## 도구 사용 방법

도구를 사용하려면 다음 형식으로 출력하세요:

<tool_call>
<name>도구이름</name>
<parameters>{"key": "value"}</parameters>
</tool_call>

## 핵심 원칙: 먼저 행동하고, 결과로 답변하기

**중요**: 사용자가 코드에 대해 질문하면 절대로 추측하거나 일반적인 조언을 하지 마세요.
반드시 도구를 사용해서 실제 코드를 확인한 후 답변하세요.

### 코드 위치 찾기 / 특정 기능 찾기 요청 시:
사용자가 "~코드가 어디있어?", "~를 담당하는 코드", "~기능이 어디서 구현돼?", "~찾아줘" 등을 물으면:

**즉시 도구를 호출하세요!** 설명 없이 바로 검색부터 시작하세요.

1. **search_files 도구로 관련 키워드 검색** (여러 키워드로 시도)
2. **list_files로 관련 파일 패턴 검색** (예: **/*.mustache, **/*.template 등)
3. 검색 결과에서 관련 파일을 찾으면 **read_file로 해당 파일 읽기**
4. 실제 코드 위치와 내용을 찾아서 구체적으로 답변

**절대 하지 말 것:**
- "다음 키워드로 검색해보세요" 라고 안내만 하기
- "보통 이런 파일에 있습니다" 라고 추측하기
- 코드를 보여주지 않고 설명만 하기

**올바른 예시:**
사용자: "이메일 템플릿 렌더링하는거 찾아줘"
→ 바로 search_files로 "email", "template", "render" 검색
→ list_files로 "**/*.mustache", "**/*.hbs", "**/*.ejs" 등 템플릿 파일 검색
→ 찾은 파일들을 read_file로 읽기
→ 실제 코드 위치와 내용으로 답변

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

1. **적극적으로 탐색하세요**: 사용자 질문에 도구를 사용하지 않고 답변하지 마세요.
2. **먼저 검색하세요**: 코드 위치를 모르면 search_files나 list_files로 먼저 찾으세요.
3. 파일을 수정하기 전에 반드시 먼저 read_file로 현재 내용을 확인하세요.
4. edit_file의 searchContent는 파일에 정확히 존재하는 내용이어야 합니다.
5. 한 번에 하나의 도구만 호출하세요.
6. 도구 실행 결과를 받은 후 다음 도구를 호출하거나 사용자에게 결과를 설명하세요.
7. 한국어로 답변해주세요.
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
 * 사용자 메시지에서 Task 제목 추출
 */
function extractTaskTitle(userMessage: string): string {
  // 질문 패턴에서 핵심 내용 추출
  const patterns = [
    /(.+?)(?:를|을)\s*(?:찾아|검색해|찾아줘|검색해줘)/,
    /(.+?)(?:가|이)\s*(?:어디|어디에)/,
    /(.+?)(?:코드|기능|함수|클래스)/,
  ];

  for (const pattern of patterns) {
    const match = userMessage.match(pattern);
    if (match) {
      return match[1].trim().substring(0, 30) + ' 찾기';
    }
  }

  // 기본 제목: 메시지의 첫 30자
  const shortMessage = userMessage.substring(0, 30);
  return shortMessage + (userMessage.length > 30 ? '...' : '');
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
    onTaskStart?: (taskId: string, title: string, description: string) => void;
    onTaskComplete?: (taskId: string) => void;
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
  let taskStarted = false;
  const taskId = `task_${Date.now()}`;
  const taskTitle = extractTaskTitle(message);

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
          // 첫 번째 도구 호출 시 Task 시작 알림
          if (!taskStarted) {
            taskStarted = true;
            const description = parsed.textContent.trim() || message;
            options.onTaskStart?.(taskId, taskTitle, description);
          }

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
            content: `도구 실행 결과:\n${toolResultsText}\n\n위 결과를 바탕으로 계속 진행하거나 사용자에게 답변해주세요.`,
          });

          // 다음 반복으로 계속
          continue;
        }
      }

      // 도구 호출이 없으면 완료
      if (taskStarted) {
        options.onTaskComplete?.(taskId);
      }
      finalResponse += currentResponse;
      options.onComplete(finalResponse);
      return;

    } catch (error) {
      if (taskStarted) {
        options.onTaskComplete?.(taskId);
      }
      options.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
  }

  // 최대 반복 도달
  if (taskStarted) {
    options.onTaskComplete?.(taskId);
  }
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
