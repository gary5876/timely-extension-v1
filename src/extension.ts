import * as vscode from 'vscode';
import { TimelyViewProvider } from './providers/TimelyViewProvider';
import { TimelyChatPanel } from './providers/TimelyChatPanel';
import { getExtensionConfig, ensureApiKey, hasApiKey } from './utils/config';
import { initializeClient, destroyClient, isClientInitialized } from './services/chatService';
import { clearAllSessions } from './utils/session';

let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Timely Chat extension is now active');

  // 상태바 초기화
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'timely-chat.openChat';
  updateStatusBar(hasApiKey() ? 'ready' : 'not-configured');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 사이드바 프로바이더 등록
  const sidebarProvider = new TimelyViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TimelyViewProvider.viewType,
      sidebarProvider
    )
  );

  // 명령어: 채팅 열기 (Ctrl+Alt+C) - 새 채팅 패널 생성
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.openChat', async () => {
      const apiKey = await ensureApiKey();
      if (!apiKey) {
        vscode.window.showWarningMessage('Timely Chat을 사용하려면 API Key가 필요합니다.');
        return;
      }

      // SDK 클라이언트 초기화
      if (!isClientInitialized()) {
        initializeClient(apiKey);
      }

      updateStatusBar('ready');
      // 항상 새 채팅 패널 생성
      TimelyChatPanel.createNew(context.extensionUri, context);
    })
  );

  // 명령어: 채팅 닫기
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.closeChat', async () => {
      TimelyChatPanel.kill();
      // 패널 닫기
      await vscode.commands.executeCommand('workbench.action.closePanel');
    })
  );

  // 명령어: 설정 열기
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.configure', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'timelyChat');
    })
  );

  // 명령어: 선택한 코드 전송 (Ctrl+Alt+S)
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.sendSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('활성화된 에디터가 없습니다.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('선택한 텍스트가 없습니다.');
        return;
      }

      const apiKey = await ensureApiKey();
      if (!apiKey) {
        vscode.window.showWarningMessage('Timely Chat을 사용하려면 API Key가 필요합니다.');
        return;
      }

      if (!isClientInitialized()) {
        initializeClient(apiKey);
      }

      const selectedText = editor.document.getText(selection);
      const languageId = editor.document.languageId;
      const fileName = editor.document.fileName.split(/[/\\]/).pop() || 'unknown';

      // 채팅 패널 열고 코드 전송
      TimelyChatPanel.createOrShow(context.extensionUri, context);

      // 약간 딜레이 후 코드 전송 (패널이 준비될 시간)
      setTimeout(() => {
        if (TimelyChatPanel.currentPanel) {
          TimelyChatPanel.currentPanel.sendCodeSelection(selectedText, languageId, fileName);
        }
      }, 300);
    })
  );

  // 명령어: 새 대화 시작 (새 패널 생성)
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.newChat', async () => {
      const apiKey = await ensureApiKey();
      if (!apiKey) {
        vscode.window.showWarningMessage('Timely Chat을 사용하려면 API Key가 필요합니다.');
        return;
      }

      if (!isClientInitialized()) {
        initializeClient(apiKey);
      }

      // 새 채팅 패널 생성
      TimelyChatPanel.createNew(context.extensionUri, context);
    })
  );

  // 명령어: 대화 기록 삭제
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.clearHistory', async () => {
      const answer = await vscode.window.showWarningMessage(
        '모든 대화 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
        '삭제',
        '취소'
      );

      if (answer === '삭제') {
        await clearAllSessions(context);
        TimelyChatPanel.killAll();
        vscode.window.showInformationMessage('대화 기록이 삭제되었습니다.');
      }
    })
  );

  // 설정 변경 감지
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('timelyChat')) {
        // API Key 변경 시 클라이언트 재초기화
        destroyClient();

        const config = getExtensionConfig();
        if (config.apiKey) {
          initializeClient(config.apiKey);
          updateStatusBar('ready');
        } else {
          updateStatusBar('not-configured');
        }
      }
    })
  );

  // 시작 시 API Key가 있으면 클라이언트 초기화
  const config = getExtensionConfig();
  if (config.apiKey) {
    initializeClient(config.apiKey);
    updateStatusBar('ready');
  }

  // API Key 없으면 입력 요청 (시작 시)
  if (!hasApiKey()) {
    setTimeout(async () => {
      const apiKey = await ensureApiKey();
      if (apiKey) {
        initializeClient(apiKey);
        updateStatusBar('ready');
      }
    }, 500);
  }
}

function updateStatusBar(status: 'ready' | 'not-configured' | 'error') {
  if (!statusBarItem) return;

  switch (status) {
    case 'ready':
      statusBarItem.text = '$(comment-discussion) Timely Chat';
      statusBarItem.tooltip = '채팅 열기 (Ctrl+Alt+C)';
      statusBarItem.backgroundColor = undefined;
      statusBarItem.command = 'timely-chat.openChat';
      break;
    case 'not-configured':
      statusBarItem.text = '$(comment-discussion) Timely Chat';
      statusBarItem.tooltip = 'API Key를 설정하려면 클릭하세요';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.command = 'timely-chat.openChat';
      break;
    case 'error':
      statusBarItem.text = '$(alert) Timely Chat';
      statusBarItem.tooltip = '오류 발생. 클릭하여 설정 확인';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      statusBarItem.command = 'timely-chat.configure';
      break;
  }
}

export function deactivate() {
  TimelyChatPanel.killAll();
  destroyClient();
}
