/**
 * Tool Parser for Timely Chat
 * AI 응답에서 도구 호출을 파싱
 */

import type {
  ToolCall,
  ToolName,
  ParsedAIResponse,
  ToolResult,
  FileContent,
  FileListResult,
  SearchResult,
  EditResult,
} from '../types/tools';

/**
 * 고유 ID 생성
 */
function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * AI 응답에서 도구 호출 파싱
 *
 * 형식:
 * <tool_call>
 * <name>read_file</name>
 * <parameters>{"path": "src/index.ts"}</parameters>
 * </tool_call>
 */
export function parseToolCalls(content: string): ParsedAIResponse {
  const toolCalls: ToolCall[] = [];
  let textContent = content;

  // 도구 호출 패턴 매칭
  const toolCallPattern = /<tool_call>\s*<name>(\w+)<\/name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/tool_call>/g;

  let match: RegExpExecArray | null;
  while ((match = toolCallPattern.exec(content)) !== null) {
    const toolName = match[1] as ToolName;
    const parametersStr = match[2].trim();

    try {
      const parameters = JSON.parse(parametersStr);

      // 유효한 도구 이름 확인
      if (isValidToolName(toolName)) {
        toolCalls.push({
          id: generateToolCallId(),
          name: toolName,
          parameters,
        });
      }
    } catch (e) {
      // JSON 파싱 실패 - 무시
      console.warn('Tool call parameter parsing failed:', parametersStr);
    }

    // 도구 호출 부분을 텍스트에서 제거
    textContent = textContent.replace(match[0], '').trim();
  }

  return {
    textContent,
    toolCalls,
    hasToolCalls: toolCalls.length > 0,
  };
}

/**
 * 유효한 도구 이름인지 확인
 */
function isValidToolName(name: string): name is ToolName {
  return ['read_file', 'write_file', 'edit_file', 'list_files', 'search_files'].includes(name);
}

/**
 * 도구 결과를 AI에게 전달할 텍스트로 포맷팅
 */
export function formatToolResultForAI(result: ToolResult): string {
  const lines: string[] = [];

  lines.push(`<tool_result>`);
  lines.push(`<tool_call_id>${result.toolCallId}</tool_call_id>`);
  lines.push(`<tool_name>${result.toolName}</tool_name>`);
  lines.push(`<success>${result.success}</success>`);

  if (result.success && result.result) {
    lines.push(`<output>`);
    lines.push(formatResultContent(result));
    lines.push(`</output>`);
  } else if (result.error) {
    lines.push(`<error>${result.error}</error>`);
  }

  lines.push(`</tool_result>`);

  return lines.join('\n');
}

/**
 * 결과 내용 포맷팅
 */
function formatResultContent(result: ToolResult): string {
  if (!result.result) return '';

  switch (result.toolName) {
    case 'read_file': {
      const fileContent = result.result as FileContent;
      return `파일: ${fileContent.path}\n줄 수: ${fileContent.lineCount}\n${fileContent.truncated ? '(일부만 표시됨)\n' : ''}\n${fileContent.content}`;
    }

    case 'write_file': {
      return result.result as string;
    }

    case 'edit_file': {
      const editResult = result.result as EditResult;
      return `파일: ${editResult.path}\n변경 사항:\n${editResult.diff}`;
    }

    case 'list_files': {
      const listResult = result.result as FileListResult;
      const fileList = listResult.files
        .map(f => `  ${f.isDirectory ? '📁' : '📄'} ${f.path}`)
        .join('\n');
      return `디렉토리: ${listResult.directory}\n총 ${listResult.totalCount}개 파일\n\n${fileList}`;
    }

    case 'search_files': {
      const searchResult = result.result as SearchResult;
      if (searchResult.matches.length === 0) {
        return `"${searchResult.query}" 검색 결과 없음`;
      }
      const matchList = searchResult.matches
        .map(m => `  ${m.path}:${m.line}: ${m.content}`)
        .join('\n');
      return `"${searchResult.query}" 검색 결과: ${searchResult.totalMatches}개\n\n${matchList}`;
    }

    default:
      return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
  }
}

/**
 * 도구 결과를 사용자에게 표시할 텍스트로 포맷팅
 */
export function formatToolResultForDisplay(result: ToolResult): string {
  if (!result.success) {
    return `❌ 오류: ${result.error}`;
  }

  switch (result.toolName) {
    case 'read_file': {
      const fileContent = result.result as FileContent;
      return `📄 ${fileContent.path} (${fileContent.lineCount}줄)`;
    }

    case 'write_file': {
      return `✅ ${result.result}`;
    }

    case 'edit_file': {
      const editResult = result.result as EditResult;
      return `📝 ${editResult.path} 편집 준비됨`;
    }

    case 'list_files': {
      const listResult = result.result as FileListResult;
      return `📁 ${listResult.directory}: ${listResult.totalCount}개 파일`;
    }

    case 'search_files': {
      const searchResult = result.result as SearchResult;
      return `🔍 "${searchResult.query}": ${searchResult.totalMatches}개 결과`;
    }

    default:
      return '✅ 완료';
  }
}

/**
 * 도구 호출을 사람이 읽기 쉬운 설명으로 변환
 */
export function describeToolCall(toolCall: ToolCall): string {
  switch (toolCall.name) {
    case 'read_file': {
      const params = toolCall.parameters as { path: string };
      return `파일 읽기: ${params.path}`;
    }
    case 'write_file': {
      const params = toolCall.parameters as { path: string };
      return `파일 생성: ${params.path}`;
    }
    case 'edit_file': {
      const params = toolCall.parameters as { path: string };
      return `파일 편집: ${params.path}`;
    }
    case 'list_files': {
      const params = toolCall.parameters as { directory?: string };
      return `파일 목록: ${params.directory || '.'}`;
    }
    case 'search_files': {
      const params = toolCall.parameters as { query: string };
      return `검색: "${params.query}"`;
    }
    default:
      return `도구 호출: ${toolCall.name}`;
  }
}
