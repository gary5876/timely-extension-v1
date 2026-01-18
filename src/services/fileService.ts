/**
 * File Service for Timely Chat
 * 파일 읽기/쓰기/편집 작업 서비스
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type {
  ToolResult,
  ReadFileParams,
  WriteFileParams,
  EditFileParams,
  ListFilesParams,
  SearchFilesParams,
  FileContent,
  FileListResult,
  FileInfo,
  SearchResult,
  SearchMatch,
  EditResult,
} from '../types/tools';
import { generateUnifiedDiff } from '../utils/diffGenerator';

// 설정에서 차단할 파일 패턴 (기본값)
const DEFAULT_BLOCKED_PATTERNS = [
  '.env',
  '.env.*',
  '*.key',
  '*.pem',
  '*.p12',
  'credentials.*',
  '**/node_modules/**',
  '**/.git/**',
];

// 최대 파일 크기 (기본 100KB)
const DEFAULT_MAX_FILE_SIZE = 100000;

/**
 * Workspace 루트 경로 가져오기
 */
function getWorkspaceRoot(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri.fsPath;
  }
  return undefined;
}

/**
 * 경로 검증 - workspace 내부인지 확인
 */
export function validatePath(filePath: string): {
  valid: boolean;
  normalizedPath: string;
  fullPath: string;
  error?: string;
} {
  const workspaceRoot = getWorkspaceRoot();

  if (!workspaceRoot) {
    return {
      valid: false,
      normalizedPath: filePath,
      fullPath: filePath,
      error: '열린 워크스페이스가 없습니다.',
    };
  }

  // 경로 정규화
  let normalizedPath = filePath.replace(/\\/g, '/');

  // 상대 경로면 workspace 기준으로 변환
  let fullPath: string;
  if (path.isAbsolute(normalizedPath)) {
    fullPath = path.normalize(normalizedPath);
  } else {
    fullPath = path.normalize(path.join(workspaceRoot, normalizedPath));
  }

  // workspace 루트 내부인지 확인
  const relativePath = path.relative(workspaceRoot, fullPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return {
      valid: false,
      normalizedPath,
      fullPath,
      error: '워크스페이스 외부의 파일에 접근할 수 없습니다.',
    };
  }

  // 차단된 패턴 확인
  const config = vscode.workspace.getConfiguration('timelyChat');
  const blockedPatterns = config.get<string[]>('blockedFilePatterns', DEFAULT_BLOCKED_PATTERNS);

  for (const pattern of blockedPatterns) {
    if (matchPattern(relativePath, pattern)) {
      return {
        valid: false,
        normalizedPath,
        fullPath,
        error: `보안상 이 파일에 접근할 수 없습니다: ${pattern}`,
      };
    }
  }

  return {
    valid: true,
    normalizedPath: relativePath,
    fullPath,
  };
}

/**
 * 간단한 패턴 매칭
 */
function matchPattern(filePath: string, pattern: string): boolean {
  // 간단한 glob 패턴 지원
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(filePath) || regex.test(path.basename(filePath));
}

/**
 * 파일 읽기
 */
export async function readFile(params: ReadFileParams): Promise<ToolResult> {
  const validation = validatePath(params.path);

  if (!validation.valid) {
    return {
      toolCallId: '',
      toolName: 'read_file',
      success: false,
      error: validation.error,
    };
  }

  try {
    const uri = vscode.Uri.file(validation.fullPath);

    // 파일 존재 확인
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      return {
        toolCallId: '',
        toolName: 'read_file',
        success: false,
        error: `파일을 찾을 수 없습니다: ${params.path}`,
      };
    }

    // 파일 크기 확인
    const stat = await vscode.workspace.fs.stat(uri);
    const config = vscode.workspace.getConfiguration('timelyChat');
    const maxSize = config.get<number>('maxFileReadSize', DEFAULT_MAX_FILE_SIZE);

    if (stat.size > maxSize) {
      return {
        toolCallId: '',
        toolName: 'read_file',
        success: false,
        error: `파일이 너무 큽니다 (${Math.round(stat.size / 1024)}KB). 최대 ${Math.round(maxSize / 1024)}KB까지 읽을 수 있습니다.`,
      };
    }

    // 파일 읽기
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const fullContent = Buffer.from(contentBytes).toString('utf-8');
    const lines = fullContent.split('\n');

    // 줄 범위 처리
    let startLine = params.startLine ?? 1;
    let endLine = params.endLine ?? lines.length;

    // 1-based to 0-based
    startLine = Math.max(1, startLine) - 1;
    endLine = Math.min(lines.length, endLine);

    const selectedLines = lines.slice(startLine, endLine);

    // 줄 번호 추가
    const numberedContent = selectedLines
      .map((line, idx) => `${String(startLine + idx + 1).padStart(4, ' ')}│ ${line}`)
      .join('\n');

    const result: FileContent = {
      path: validation.normalizedPath,
      content: numberedContent,
      lineCount: selectedLines.length,
      truncated: endLine < lines.length || startLine > 0,
    };

    return {
      toolCallId: '',
      toolName: 'read_file',
      success: true,
      result,
    };
  } catch (error) {
    return {
      toolCallId: '',
      toolName: 'read_file',
      success: false,
      error: `파일 읽기 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 파일 쓰기
 */
export async function writeFile(params: WriteFileParams): Promise<ToolResult> {
  const validation = validatePath(params.path);

  if (!validation.valid) {
    return {
      toolCallId: '',
      toolName: 'write_file',
      success: false,
      error: validation.error,
    };
  }

  try {
    const uri = vscode.Uri.file(validation.fullPath);

    // 부모 디렉토리 생성
    const parentDir = path.dirname(validation.fullPath);
    const parentUri = vscode.Uri.file(parentDir);

    try {
      await vscode.workspace.fs.stat(parentUri);
    } catch {
      await vscode.workspace.fs.createDirectory(parentUri);
    }

    // 파일 쓰기
    const content = Buffer.from(params.content, 'utf-8');
    await vscode.workspace.fs.writeFile(uri, content);

    return {
      toolCallId: '',
      toolName: 'write_file',
      success: true,
      result: `파일이 생성되었습니다: ${validation.normalizedPath}`,
    };
  } catch (error) {
    return {
      toolCallId: '',
      toolName: 'write_file',
      success: false,
      error: `파일 쓰기 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 파일 편집 (search & replace)
 */
export async function editFile(params: EditFileParams): Promise<ToolResult> {
  const validation = validatePath(params.path);

  if (!validation.valid) {
    return {
      toolCallId: '',
      toolName: 'edit_file',
      success: false,
      error: validation.error,
    };
  }

  try {
    const uri = vscode.Uri.file(validation.fullPath);

    // 파일 읽기
    let originalContent: string;
    try {
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      originalContent = Buffer.from(contentBytes).toString('utf-8');
    } catch {
      return {
        toolCallId: '',
        toolName: 'edit_file',
        success: false,
        error: `파일을 찾을 수 없습니다: ${params.path}`,
      };
    }

    // 검색 내용 찾기
    if (!originalContent.includes(params.searchContent)) {
      return {
        toolCallId: '',
        toolName: 'edit_file',
        success: false,
        error: `검색 내용을 찾을 수 없습니다. 파일 내용을 다시 확인해주세요.`,
      };
    }

    // 내용 교체
    const newContent = originalContent.replace(params.searchContent, params.replaceContent);

    // diff 생성
    const diff = generateUnifiedDiff(
      validation.normalizedPath,
      originalContent,
      newContent
    );

    const result: EditResult = {
      path: validation.normalizedPath,
      originalContent,
      newContent,
      diff,
      applied: false, // UI에서 승인 후 적용
    };

    return {
      toolCallId: '',
      toolName: 'edit_file',
      success: true,
      result,
    };
  } catch (error) {
    return {
      toolCallId: '',
      toolName: 'edit_file',
      success: false,
      error: `파일 편집 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 편집 적용 (승인 후)
 */
export async function applyEdit(filePath: string, newContent: string): Promise<boolean> {
  const validation = validatePath(filePath);

  if (!validation.valid) {
    return false;
  }

  try {
    const uri = vscode.Uri.file(validation.fullPath);
    const content = Buffer.from(newContent, 'utf-8');
    await vscode.workspace.fs.writeFile(uri, content);
    return true;
  } catch {
    return false;
  }
}

/**
 * 파일 목록 조회
 */
export async function listFiles(params: ListFilesParams): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();

  if (!workspaceRoot) {
    return {
      toolCallId: '',
      toolName: 'list_files',
      success: false,
      error: '열린 워크스페이스가 없습니다.',
    };
  }

  try {
    const directory = params.directory || '.';
    const pattern = params.pattern || '*';

    // 검색 패턴 구성
    const searchPattern = directory === '.' || directory === ''
      ? pattern
      : `${directory}/${pattern}`;

    // 파일 검색
    const files = await vscode.workspace.findFiles(
      searchPattern,
      '**/node_modules/**',
      100
    );

    const fileInfos: FileInfo[] = [];

    for (const file of files) {
      try {
        const stat = await vscode.workspace.fs.stat(file);
        const relativePath = path.relative(workspaceRoot, file.fsPath);

        fileInfos.push({
          name: path.basename(file.fsPath),
          path: relativePath.replace(/\\/g, '/'),
          isDirectory: stat.type === vscode.FileType.Directory,
          size: stat.size,
        });
      } catch {
        // 접근 불가 파일 무시
      }
    }

    // 이름순 정렬
    fileInfos.sort((a, b) => a.path.localeCompare(b.path));

    const result: FileListResult = {
      directory: directory,
      files: fileInfos,
      totalCount: fileInfos.length,
    };

    return {
      toolCallId: '',
      toolName: 'list_files',
      success: true,
      result,
    };
  } catch (error) {
    return {
      toolCallId: '',
      toolName: 'list_files',
      success: false,
      error: `파일 목록 조회 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 파일 내용 검색
 */
export async function searchFiles(params: SearchFilesParams): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();

  if (!workspaceRoot) {
    return {
      toolCallId: '',
      toolName: 'search_files',
      success: false,
      error: '열린 워크스페이스가 없습니다.',
    };
  }

  try {
    const searchPath = params.path || '';
    const filePattern = params.filePattern || '**/*';

    // 검색 패턴 구성
    const pattern = searchPath
      ? `${searchPath}/${filePattern}`
      : filePattern;

    // 파일 검색
    const files = await vscode.workspace.findFiles(
      pattern,
      '**/node_modules/**',
      50
    );

    const matches: SearchMatch[] = [];
    const query = params.query.toLowerCase();

    for (const file of files) {
      try {
        const contentBytes = await vscode.workspace.fs.readFile(file);
        const content = Buffer.from(contentBytes).toString('utf-8');
        const lines = content.split('\n');

        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(query)) {
            const relativePath = path.relative(workspaceRoot, file.fsPath);
            matches.push({
              path: relativePath.replace(/\\/g, '/'),
              line: idx + 1,
              content: line.trim().substring(0, 200),
            });
          }
        });

        // 최대 50개 매치까지만
        if (matches.length >= 50) break;
      } catch {
        // 읽기 불가 파일 무시
      }
    }

    const result: SearchResult = {
      query: params.query,
      matches,
      totalMatches: matches.length,
    };

    return {
      toolCallId: '',
      toolName: 'search_files',
      success: true,
      result,
    };
  } catch (error) {
    return {
      toolCallId: '',
      toolName: 'search_files',
      success: false,
      error: `검색 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
