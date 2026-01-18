/**
 * Diff Generator for Timely Chat
 * 파일 편집 전후 diff 생성 유틸리티
 */

/**
 * 간단한 Unified Diff 생성
 */
export function generateUnifiedDiff(
  filePath: string,
  originalContent: string,
  newContent: string
): string {
  const originalLines = originalContent.split('\n');
  const newLines = newContent.split('\n');

  const diff: string[] = [];
  diff.push(`--- a/${filePath}`);
  diff.push(`+++ b/${filePath}`);

  // 변경된 부분 찾기
  const changes = findChanges(originalLines, newLines);

  for (const change of changes) {
    // 헝크 헤더
    diff.push(`@@ -${change.originalStart},${change.originalCount} +${change.newStart},${change.newCount} @@`);

    // 컨텍스트 및 변경 내용
    for (const line of change.lines) {
      diff.push(line);
    }
  }

  return diff.join('\n');
}

interface DiffChange {
  originalStart: number;
  originalCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * 변경된 부분 찾기 (간단한 구현)
 */
function findChanges(original: string[], modified: string[]): DiffChange[] {
  const changes: DiffChange[] = [];
  let i = 0;
  let j = 0;

  while (i < original.length || j < modified.length) {
    // 동일한 줄 건너뛰기
    if (i < original.length && j < modified.length && original[i] === modified[j]) {
      i++;
      j++;
      continue;
    }

    // 변경 시작점 찾기
    const changeStartOrig = i;
    const changeStartNew = j;
    const lines: string[] = [];

    // 컨텍스트 (이전 3줄)
    const contextStart = Math.max(0, changeStartOrig - 3);
    for (let k = contextStart; k < changeStartOrig; k++) {
      lines.push(` ${original[k]}`);
    }

    // 삭제된 줄 찾기
    const deletedLines: string[] = [];
    const addedLines: string[] = [];

    // 변경 영역 찾기 (간단한 휴리스틱)
    let lookAhead = 10;
    let foundSync = false;

    while (!foundSync && (i < original.length || j < modified.length) && lookAhead > 0) {
      // 다시 동기화되는 지점 찾기
      if (i < original.length && j < modified.length) {
        // 다음 동일한 줄 찾기
        let syncOffset = -1;
        for (let offset = 0; offset < 5; offset++) {
          if (
            i + offset < original.length &&
            j + offset < modified.length &&
            original[i + offset] === modified[j + offset]
          ) {
            syncOffset = offset;
            break;
          }
        }

        if (syncOffset >= 0) {
          // 삭제된 줄
          for (let k = 0; k < syncOffset; k++) {
            if (i < original.length) {
              deletedLines.push(original[i]);
              i++;
            }
          }
          // 추가된 줄
          for (let k = 0; k < syncOffset; k++) {
            if (j < modified.length) {
              addedLines.push(modified[j]);
              j++;
            }
          }
          foundSync = true;
        } else {
          // 동기화 지점 없음 - 한 줄씩 처리
          if (i < original.length) {
            deletedLines.push(original[i]);
            i++;
          }
          if (j < modified.length) {
            addedLines.push(modified[j]);
            j++;
          }
          lookAhead--;
        }
      } else if (i < original.length) {
        deletedLines.push(original[i]);
        i++;
        lookAhead--;
      } else if (j < modified.length) {
        addedLines.push(modified[j]);
        j++;
        lookAhead--;
      }
    }

    // 삭제 줄 추가
    for (const line of deletedLines) {
      lines.push(`-${line}`);
    }

    // 추가 줄 추가
    for (const line of addedLines) {
      lines.push(`+${line}`);
    }

    // 컨텍스트 (이후 3줄)
    const contextEnd = Math.min(original.length, i + 3);
    for (let k = i; k < contextEnd; k++) {
      if (original[k] !== undefined) {
        lines.push(` ${original[k]}`);
      }
    }

    if (deletedLines.length > 0 || addedLines.length > 0) {
      changes.push({
        originalStart: contextStart + 1,
        originalCount: (i - contextStart) + (contextEnd - i),
        newStart: Math.max(1, changeStartNew - 3 + 1),
        newCount: (j - changeStartNew) + Math.min(3, modified.length - j) + Math.min(3, changeStartNew),
        lines,
      });
    }
  }

  return changes;
}

/**
 * HTML용 diff 포맷팅
 */
export function formatDiffForHtml(diff: string): string {
  const lines = diff.split('\n');
  const htmlLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      htmlLines.push(`<div class="diff-file-header">${escapeHtml(line)}</div>`);
    } else if (line.startsWith('@@')) {
      htmlLines.push(`<div class="diff-hunk-header">${escapeHtml(line)}</div>`);
    } else if (line.startsWith('-')) {
      htmlLines.push(`<div class="diff-line diff-removed">${escapeHtml(line)}</div>`);
    } else if (line.startsWith('+')) {
      htmlLines.push(`<div class="diff-line diff-added">${escapeHtml(line)}</div>`);
    } else {
      htmlLines.push(`<div class="diff-line diff-context">${escapeHtml(line)}</div>`);
    }
  }

  return htmlLines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
