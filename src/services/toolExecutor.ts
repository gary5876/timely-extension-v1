/**
 * Tool Executor for Timely Chat
 * 도구 호출 실행 및 결과 관리
 */

import type {
  ToolCall,
  ToolResult,
  ReadFileParams,
  WriteFileParams,
  EditFileParams,
  ListFilesParams,
  SearchFilesParams,
} from '../types/tools';
import {
  readFile,
  writeFile,
  editFile,
  listFiles,
  searchFiles,
} from './fileService';

/**
 * 단일 도구 호출 실행
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  let result: ToolResult;

  switch (toolCall.name) {
    case 'read_file':
      result = await readFile(toolCall.parameters as ReadFileParams);
      break;

    case 'write_file':
      result = await writeFile(toolCall.parameters as WriteFileParams);
      break;

    case 'edit_file':
      result = await editFile(toolCall.parameters as EditFileParams);
      break;

    case 'list_files':
      result = await listFiles(toolCall.parameters as ListFilesParams);
      break;

    case 'search_files':
      result = await searchFiles(toolCall.parameters as SearchFilesParams);
      break;

    default:
      result = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: `알 수 없는 도구: ${toolCall.name}`,
      };
  }

  // 도구 호출 ID 설정
  result.toolCallId = toolCall.id;

  return result;
}

/**
 * 여러 도구 호출 순차 실행
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  callbacks?: {
    onStart?: (toolCall: ToolCall) => void;
    onComplete?: (toolCall: ToolCall, result: ToolResult) => void;
    onError?: (toolCall: ToolCall, error: Error) => void;
  }
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const toolCall of toolCalls) {
    try {
      callbacks?.onStart?.(toolCall);

      const result = await executeToolCall(toolCall);
      results.push(result);

      callbacks?.onComplete?.(toolCall, result);
    } catch (error) {
      const errorResult: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(errorResult);

      callbacks?.onError?.(toolCall, error instanceof Error ? error : new Error(String(error)));
    }
  }

  return results;
}

/**
 * 파일 작업이 활성화되어 있는지 확인
 */
export function isFileOperationsEnabled(): boolean {
  const vscode = require('vscode');
  const config = vscode.workspace.getConfiguration('timelyChat');
  return config.get('enableFileOperations', true) as boolean;
}

/**
 * 자동 적용이 활성화되어 있는지 확인
 */
export function isAutoApplyEnabled(): boolean {
  const vscode = require('vscode');
  const config = vscode.workspace.getConfiguration('timelyChat');
  return config.get('fileOperationAutoApply', false) as boolean;
}
