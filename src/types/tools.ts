/**
 * Tool Types for Timely Chat File Operations
 * Claude Code 스타일 파일 작업 도구 타입 정의
 */

// 도구 이름 타입
export type ToolName = 'read_file' | 'write_file' | 'edit_file' | 'list_files' | 'search_files';

// 기본 도구 호출 인터페이스
export interface ToolCall {
  id: string;
  name: ToolName;
  parameters: ToolParameters;
}

// 도구 파라미터 유니온 타입
export type ToolParameters =
  | ReadFileParams
  | WriteFileParams
  | EditFileParams
  | ListFilesParams
  | SearchFilesParams;

// 파일 읽기 파라미터
export interface ReadFileParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

// 파일 쓰기 파라미터
export interface WriteFileParams {
  path: string;
  content: string;
}

// 파일 편집 파라미터
export interface EditFileParams {
  path: string;
  searchContent: string;
  replaceContent: string;
}

// 파일 목록 조회 파라미터
export interface ListFilesParams {
  directory?: string;
  pattern?: string;
}

// 파일 검색 파라미터
export interface SearchFilesParams {
  query: string;
  path?: string;
  filePattern?: string;
}

// 도구 실행 결과
export interface ToolResult {
  toolCallId: string;
  toolName: ToolName;
  success: boolean;
  result?: string | FileContent | FileListResult | SearchResult | EditResult;
  error?: string;
}

// 파일 내용 결과
export interface FileContent {
  path: string;
  content: string;
  lineCount: number;
  truncated: boolean;
}

// 파일 목록 결과
export interface FileListResult {
  directory: string;
  files: FileInfo[];
  totalCount: number;
}

// 파일 정보
export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

// 검색 결과
export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  totalMatches: number;
}

// 검색 매치
export interface SearchMatch {
  path: string;
  line: number;
  content: string;
  context?: string;
}

// 편집 결과
export interface EditResult {
  path: string;
  originalContent: string;
  newContent: string;
  diff: string;
  applied: boolean;
}

// 도구 실행 상태
export type ToolStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'waiting_approval';

// 도구 실행 이벤트
export interface ToolExecutionEvent {
  toolCall: ToolCall;
  status: ToolStatus;
  result?: ToolResult;
  timestamp: number;
}

// 파싱된 AI 응답
export interface ParsedAIResponse {
  textContent: string;
  toolCalls: ToolCall[];
  hasToolCalls: boolean;
}
