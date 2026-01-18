import * as vscode from 'vscode';
import { getExtensionConfig } from '../utils/config';
import type { ToolCall, ToolResult, EditResult } from '../types/tools';
import { applyEdit } from '../services/fileService';
import { describeToolCall, formatToolResultForDisplay } from '../services/toolParser';

/**
 * 에디터 패널 채팅 (멀티 인스턴스 지원)
 */
export class TimelyChatPanel {
  public static panels: Map<string, TimelyChatPanel> = new Map();
  public static readonly viewType = 'timelyChat';
  private static panelCounter = 0;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _sessionId: string;
  private _disposables: vscode.Disposable[] = [];

  /**
   * 새 채팅 패널 생성 (항상 새로 만듦)
   */
  public static createNew(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ): TimelyChatPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    TimelyChatPanel.panelCounter++;
    const panelNumber = TimelyChatPanel.panelCounter;

    const panel = vscode.window.createWebviewPanel(
      TimelyChatPanel.viewType,
      `Timely Chat ${panelNumber}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    );

    const chatPanel = new TimelyChatPanel(panel, extensionUri, context, panelNumber);
    TimelyChatPanel.panels.set(chatPanel._sessionId, chatPanel);
    return chatPanel;
  }

  /**
   * 기존 패널 표시 또는 새로 생성
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ): TimelyChatPanel {
    // 활성 패널이 있으면 표시
    if (TimelyChatPanel.panels.size > 0) {
      const lastPanel = Array.from(TimelyChatPanel.panels.values()).pop();
      if (lastPanel) {
        lastPanel._panel.reveal();
        return lastPanel;
      }
    }

    // 없으면 새로 생성
    return TimelyChatPanel.createNew(extensionUri, context);
  }

  /**
   * 모든 패널 종료
   */
  public static killAll() {
    TimelyChatPanel.panels.forEach(panel => panel.dispose());
    TimelyChatPanel.panels.clear();
  }

  /**
   * 레거시 호환성
   */
  public static kill() {
    TimelyChatPanel.killAll();
  }

  public static get currentPanel(): TimelyChatPanel | undefined {
    return Array.from(TimelyChatPanel.panels.values()).pop();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    panelNumber: number
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // 각 패널마다 고유한 세션 ID 생성
    const { generateSessionId } = require('../utils/session');
    this._sessionId = generateSessionId();

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // WebView 메시지 핸들러
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'sendMessage':
            await this._handleSendMessage(message.text);
            break;
          case 'ready':
            await this._loadMessages();
            await this._sendConfig();
            break;
          case 'changeModel':
            await this._handleChangeModel(message.model);
            break;
          case 'applyEdit':
            await this._handleApplyEdit(message.path, message.newContent);
            break;
          case 'openFile':
            await this._handleOpenFile(message.path);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private async _handleApplyEdit(filePath: string, newContent: string) {
    const success = await applyEdit(filePath, newContent);
    if (success) {
      vscode.window.showInformationMessage(`파일이 수정되었습니다: ${filePath}`);
      this._panel.webview.postMessage({ type: 'editApplied', path: filePath });
    } else {
      vscode.window.showErrorMessage(`파일 수정 실패: ${filePath}`);
    }
  }

  private async _handleOpenFile(filePath: string) {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        const fullPath = require('path').join(workspaceRoot, filePath);
        const uri = vscode.Uri.file(fullPath);
        await vscode.window.showTextDocument(uri);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`파일을 열 수 없습니다: ${filePath}`);
    }
  }

  private async _handleSendMessage(text: string) {
    const config = getExtensionConfig();
    const { initializeClient, isClientInitialized, sendMessageWithTools, createMessage } = await import('../services/chatService');
    const { saveSessionMessages, loadSessionMessages } = await import('../utils/session');

    if (!isClientInitialized()) {
      initializeClient(config.apiKey);
    }

    const messages = loadSessionMessages(this._context, this._sessionId);

    // 사용자 메시지 추가
    const userMessage = createMessage('user', text);
    messages.push(userMessage);
    this._panel.webview.postMessage({ type: 'addMessage', message: userMessage });

    // AI 응답 placeholder 추가
    const assistantMessage = createMessage('assistant', '', true);
    messages.push(assistantMessage);
    this._panel.webview.postMessage({ type: 'addMessage', message: assistantMessage });

    // 도구 지원 스트리밍 응답
    await sendMessageWithTools(this._sessionId, text, {
      model: config.model,
      instructions: config.instructions,
      enableTools: true,
      onToken: (token) => {
        this._panel.webview.postMessage({
          type: 'appendToken',
          messageId: assistantMessage.id,
          token,
        });
      },
      onTaskStart: (taskId: string, title: string, description: string) => {
        // Task 블록 시작 알림
        this._panel.webview.postMessage({
          type: 'taskStart',
          taskId,
          title,
          description,
        });
      },
      onTaskComplete: (taskId: string) => {
        // Task 완료 알림
        this._panel.webview.postMessage({
          type: 'taskComplete',
          taskId,
        });
      },
      onToolCall: (toolCall: ToolCall) => {
        // 도구 실행 시작 알림
        this._panel.webview.postMessage({
          type: 'toolCallStart',
          toolCall,
          description: describeToolCall(toolCall),
        });
      },
      onToolResult: (result: ToolResult) => {
        // 도구 실행 결과 알림
        this._panel.webview.postMessage({
          type: 'toolCallComplete',
          result,
          description: formatToolResultForDisplay(result),
        });

        // 편집 결과인 경우 diff 표시
        if (result.toolName === 'edit_file' && result.success && result.result) {
          const editResult = result.result as EditResult;
          this._panel.webview.postMessage({
            type: 'showDiff',
            path: editResult.path,
            diff: editResult.diff,
            newContent: editResult.newContent,
          });
        }
      },
      onComplete: async (fullMessage) => {
        assistantMessage.content = fullMessage;
        assistantMessage.isStreaming = false;
        this._panel.webview.postMessage({
          type: 'completeMessage',
          messageId: assistantMessage.id,
        });
        await saveSessionMessages(this._context, this._sessionId, messages);
      },
      onError: (error) => {
        this._panel.webview.postMessage({
          type: 'error',
          message: error.message,
        });
        vscode.window.showErrorMessage(`Timely Chat: ${error.message}`);
      },
    });
  }

  private async _loadMessages() {
    const { loadSessionMessages } = await import('../utils/session');
    const messages = loadSessionMessages(this._context, this._sessionId);
    this._panel.webview.postMessage({ type: 'loadMessages', messages });
  }

  private async _sendConfig() {
    const config = getExtensionConfig();
    // SDK의 AVAILABLE_MODELS와 동일한 정확한 모델 ID
    const models = [
      // ChatGPT
      'gpt-5.2', 'gpt-5.2 chat', 'gpt-5.1', 'gpt-5.1 chat',
      'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
      'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o',
      'gpt-o4-mini', 'gpt-o3',
      'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5-codex', 'codex-mini',
      'o3-deep-research',
      // Google Gemini
      'gemini-3-flash', 'gemini-3-pro',
      'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro',
      // Anthropic Claude
      'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5',
      'claude-opus-4-1', 'claude-sonnet-4-0', 'claude-opus-4-0',
      // Meta Llama
      'llama-4-scout-17b', 'llama-4-maverick-17b',
      // Mistral
      'mistral-small', 'mistral-medium', 'mistral-large',
      'magistral-medium', 'magistral-small', 'devstral-medium', 'codestral',
      // Qwen
      'qwen-qwq-32b',
      // Grok
      'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning',
      'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning', 'grok-4',
      'grok-3', 'grok-3-mini', 'grok-code-fast',
      // Upstage
      'solar-pro2'
    ];
    this._panel.webview.postMessage({
      type: 'config',
      model: config.model,
      models
    });
  }

  private async _handleChangeModel(model: string) {
    const config = vscode.workspace.getConfiguration('timelyChat');
    await config.update('model', model, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`모델이 ${model}로 변경되었습니다.`);
  }

  public sendCodeSelection(code: string, language: string, fileName: string) {
    const formattedMessage = `이 코드에 대해 질문이 있어요:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n파일: ${fileName}`;
    this._panel.webview.postMessage({ type: 'setInput', text: formattedMessage });
  }

  public dispose() {
    // 맵에서 제거
    TimelyChatPanel.panels.delete(this._sessionId);
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  public get sessionId(): string {
    return this._sessionId;
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Timely Chat</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* 헤더 */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      min-height: 52px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .header-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--vscode-foreground);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .model-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      outline: none;
      max-width: 180px;
      transition: border-color 0.15s ease;
    }

    .model-select:hover {
      border-color: var(--vscode-focusBorder);
    }

    .model-select:focus {
      border-color: var(--vscode-focusBorder);
    }

    /* 메시지 영역 */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }

    .messages::-webkit-scrollbar {
      width: 8px;
    }

    .messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .messages::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
    }

    .messages::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }

    .message {
      padding: 20px 24px;
      animation: fadeIn 0.2s ease;
    }

    .message.user {
      background: var(--vscode-editor-background);
    }

    .message.assistant {
      background: var(--vscode-sideBar-background, rgba(0,0,0,0.05));
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .message-avatar {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .message-avatar.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .message-avatar.assistant {
      background: linear-gradient(135deg, #da7756 0%, #d4a574 100%);
      color: white;
    }

    .message-role {
      font-weight: 600;
      font-size: 14px;
      color: var(--vscode-foreground);
    }

    .message-content {
      font-size: 14px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
      padding-left: 38px;
    }

    .message-content p {
      margin-bottom: 14px;
    }

    .message-content p:last-child {
      margin-bottom: 0;
    }

    /* 코드 블록 */
    .message-content code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
    }

    .code-block {
      position: relative;
      margin: 14px 0;
      border-radius: 8px;
      background: var(--vscode-textCodeBlock-background);
      overflow: hidden;
    }

    .code-block-header {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: 6px 10px;
      background: rgba(0,0,0,0.2);
    }

    .code-block-copy {
      background: transparent;
      border: none;
      color: #888;
      cursor: pointer;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .code-block-copy:hover {
      background: rgba(255,255,255,0.1);
      color: var(--vscode-foreground);
    }

    .code-block-copy svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: #888;
    }

    .code-block-copy:hover svg {
      fill: var(--vscode-foreground);
    }

    .message-content pre {
      margin: 0;
      padding: 14px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      line-height: 1.5;
    }

    .message-content pre code {
      background: transparent;
      padding: 0;
      border-radius: 0;
    }

    /* 스트리밍 인디케이터 */
    .streaming-indicator {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 4px;
    }

    .streaming-dot {
      width: 5px;
      height: 5px;
      background: var(--vscode-foreground);
      border-radius: 50%;
      animation: pulse 1.4s infinite ease-in-out;
    }

    .streaming-dot:nth-child(1) { animation-delay: 0s; }
    .streaming-dot:nth-child(2) { animation-delay: 0.2s; }
    .streaming-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    /* Task 블록 (Claude Code 스타일) */
    .task-block {
      margin: 12px 0;
      padding: 0;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(139, 92, 246, 0.03) 100%);
      border: 1px solid rgba(99, 102, 241, 0.1);
    }

    .task-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(99, 102, 241, 0.08);
      background: rgba(99, 102, 241, 0.04);
      border-radius: 8px 8px 0 0;
    }

    .task-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      font-size: 11px;
      font-weight: 600;
      box-shadow: 0 2px 4px rgba(99, 102, 241, 0.3);
    }

    .task-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
      flex: 1;
    }

    .task-status {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      padding: 2px 8px;
      background: rgba(255,255,255,0.06);
      border-radius: 10px;
    }

    .task-body {
      padding: 12px 14px;
    }

    /* 타임라인 컨테이너 */
    .task-tools {
      position: relative;
      margin-left: 10px;
      padding-left: 20px;
      border-left: 2px solid rgba(99, 102, 241, 0.2);
    }

    /* 도구 호출 항목 */
    .tool-item {
      position: relative;
      padding: 8px 12px;
      margin: 4px 0;
      font-size: 12px;
      background: rgba(255,255,255,0.02);
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .tool-item:hover {
      background: rgba(255,255,255,0.04);
    }

    .tool-item::before {
      content: '';
      position: absolute;
      left: -26px;
      top: 50%;
      transform: translateY(-50%);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--vscode-editor-background);
      border: 2px solid rgba(99, 102, 241, 0.3);
      transition: all 0.2s ease;
    }

    .tool-item.running::before {
      border-color: #6366f1;
      background: #6366f1;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.5);
      animation: pulse-glow 1.5s infinite;
    }

    .tool-item.success::before {
      border-color: #22c55e;
      background: #22c55e;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
    }

    .tool-item.error::before {
      border-color: #ef4444;
      background: #ef4444;
      box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
    }

    @keyframes pulse-glow {
      0%, 100% {
        opacity: 1;
        box-shadow: 0 0 8px rgba(99, 102, 241, 0.5);
      }
      50% {
        opacity: 0.7;
        box-shadow: 0 0 12px rgba(99, 102, 241, 0.8);
      }
    }

    .tool-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .tool-info-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tool-type {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #a78bfa;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .tool-type-icon {
      font-size: 12px;
    }

    .tool-detail {
      color: var(--vscode-foreground);
      word-break: break-word;
      font-size: 12px;
      opacity: 0.9;
    }

    .tool-detail code {
      background: rgba(99, 102, 241, 0.1);
      color: #c4b5fd;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }

    .tool-param {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      opacity: 0.7;
    }

    .tool-result {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      margin-top: 4px;
      padding-left: 2px;
      opacity: 0.8;
    }

    .tool-result.error {
      color: #f87171;
    }

    .tool-result.success {
      color: #4ade80;
    }

    /* Computing 상태 - 타임라인 끝에 표시 */
    .computing-status {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      margin: 8px 0 4px 0;
      color: #a78bfa;
      font-size: 12px;
      font-weight: 500;
    }

    .computing-status::before {
      content: '';
      position: absolute;
      left: -26px;
      top: 50%;
      transform: translateY(-50%);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #6366f1;
      border: 2px solid #6366f1;
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.6);
      animation: pulse-glow 1.5s infinite;
    }

    .timely-spinner {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      animation: spin 1.2s linear infinite;
    }

    .timely-spinner svg {
      width: 20px;
      height: 20px;
      filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.5));
    }

    .computing-text {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .computing-dots {
      display: inline-flex;
      gap: 2px;
    }

    .computing-dots span {
      width: 4px;
      height: 4px;
      background: #a78bfa;
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out;
    }

    .computing-dots span:nth-child(1) { animation-delay: 0s; }
    .computing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .computing-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-4px); }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* 최종 응답 스타일 */
    .final-response {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }

    /* 레거시 도구 그룹 (하위 호환) */
    .tool-group {
      margin: 12px 24px;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 6px;
      overflow: hidden;
    }

    .tool-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      cursor: pointer;
      user-select: none;
      background: rgba(0,0,0,0.1);
    }

    .tool-group-header:hover {
      background: rgba(0,0,0,0.15);
    }

    .tool-group-toggle {
      font-size: 10px;
      transition: transform 0.2s ease;
    }

    .tool-group.collapsed .tool-group-toggle {
      transform: rotate(-90deg);
    }

    .tool-group-title {
      flex: 1;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .tool-group-count {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      background: rgba(255,255,255,0.1);
      padding: 2px 8px;
      border-radius: 10px;
    }

    .tool-group-items {
      max-height: 500px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .tool-group.collapsed .tool-group-items {
      max-height: 0;
    }

    /* 개별 도구 호출 */
    .tool-call {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-top: 1px solid rgba(255,255,255,0.05);
      font-size: 12px;
    }

    .tool-call:first-child {
      border-top: none;
    }

    .tool-icon {
      font-size: 14px;
      width: 20px;
      text-align: center;
    }

    .tool-name {
      flex: 1;
      color: var(--vscode-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tool-status {
      font-size: 12px;
      font-weight: 600;
    }

    .tool-status.spinner {
      width: 12px;
      height: 12px;
      border: 2px solid var(--vscode-textLink-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .tool-status.success {
      color: var(--vscode-testing-iconPassed);
    }

    .tool-status.error {
      color: var(--vscode-testing-iconFailed);
    }

    /* Diff 블록 */
    .diff-block {
      margin: 12px 24px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 8px;
      overflow: hidden;
      animation: fadeIn 0.2s ease;
    }

    .diff-header {
      padding: 10px 14px;
      background: rgba(0,0,0,0.2);
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .diff-content {
      margin: 0;
      padding: 12px 14px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
    }

    .diff-actions {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
      background: rgba(0,0,0,0.1);
    }

    .diff-btn {
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .apply-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .apply-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .reject-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .reject-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .applied-badge, .rejected-badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 4px;
    }

    .applied-badge {
      background: var(--vscode-testing-iconPassed);
      color: white;
    }

    .rejected-badge {
      background: var(--vscode-descriptionForeground);
      color: white;
    }

    /* 입력 영역 */
    .input-area {
      padding: 20px 24px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }

    .input-container {
      position: relative;
      display: flex;
      align-items: flex-end;
      gap: 12px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 12px;
      padding: 12px 16px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .input-container:focus-within {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }

    textarea {
      flex: 1;
      min-height: 24px;
      max-height: 150px;
      padding: 4px 0;
      border: none;
      background: transparent;
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 14px;
      line-height: 1.5;
      resize: none;
      outline: none;
    }

    textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .send-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
      transform: scale(1.05);
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .send-btn svg {
      width: 18px;
      height: 18px;
    }

    /* 빈 상태 */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 40px 24px;
    }

    .empty-state-icon {
      width: 64px;
      height: 64px;
      margin-bottom: 20px;
      opacity: 0.5;
    }

    .empty-state h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 10px;
    }

    .empty-state p {
      font-size: 14px;
      opacity: 0.8;
      line-height: 1.5;
      margin-bottom: 24px;
    }

    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
      max-width: 500px;
    }

    .suggestion-btn {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-foreground);
      padding: 10px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s ease;
    }

    .suggestion-btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">Timely Chat</span>
    </div>
    <div class="header-actions">
      <select class="model-select" id="modelSelect">
        <option>로딩중...</option>
      </select>
    </div>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h2>Timely Chat</h2>
      <p>AI와 대화를 시작해보세요</p>
      <div class="suggestions">
        <button class="suggestion-btn" data-prompt="이 코드를 설명해줘">"이 코드를 설명해줘"</button>
        <button class="suggestion-btn" data-prompt="버그를 찾아줘">"버그를 찾아줘"</button>
        <button class="suggestion-btn" data-prompt="리팩토링 제안해줘">"리팩토링 제안해줘"</button>
        <button class="suggestion-btn" data-prompt="테스트 코드 작성해줘">"테스트 코드 작성해줘"</button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-container">
      <textarea
        id="messageInput"
        placeholder="메시지를 입력하세요... (Shift+Enter로 줄바꿈)"
        rows="1"
      ></textarea>
      <button class="send-btn" id="sendBtn" title="전송 (Enter)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor"></polygon>
        </svg>
      </button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const modelSelect = document.getElementById('modelSelect');
    const suggestionBtns = document.querySelectorAll('.suggestion-btn');

    let messages = [];
    let isStreaming = false;

    function renderMessages() {
      if (messages.length === 0) {
        emptyState.style.display = 'flex';
        return;
      }

      emptyState.style.display = 'none';
      const existingMessages = messagesContainer.querySelectorAll('.message');
      existingMessages.forEach(el => el.remove());

      messages.forEach(msg => {
        const messageEl = createMessageElement(msg);
        messagesContainer.appendChild(messageEl);
      });

      scrollToBottom();
    }

    function createMessageElement(msg) {
      const div = document.createElement('div');
      div.className = 'message ' + msg.role;
      div.id = 'msg-' + msg.id;

      const avatar = msg.role === 'user' ? 'U' : 'AI';
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      const streamingIndicator = msg.isStreaming ? '<span class="streaming-indicator"><span class="streaming-dot"></span><span class="streaming-dot"></span><span class="streaming-dot"></span></span>' : '';

      div.innerHTML = \`
        <div class="message-header">
          <div class="message-avatar \${msg.role}">\${avatar}</div>
          <span class="message-role">\${roleLabel}</span>
        </div>
        <div class="message-content" id="content-\${msg.id}">\${formatContent(msg.content)}\${streamingIndicator}</div>
      \`;

      return div;
    }

    function formatContent(content) {
      if (!content) return '';

      // tool_call XML 태그 제거 (AI 응답에서 도구 호출 부분 숨기기)
      content = content.replace(/<tool_call>[\\s\\S]*?<\\/tool_call>/g, '');

      // tool_result XML 태그 제거
      content = content.replace(/<tool_result>[\\s\\S]*?<\\/tool_result>/g, '');

      // 스트리밍 중 불완전한 tool_call 태그도 제거 (시작은 있지만 끝이 없는 경우)
      content = content.replace(/<tool_call>[\\s\\S]*$/g, '');
      content = content.replace(/<tool_result>[\\s\\S]*$/g, '');

      // 부분적으로 입력 중인 시작 태그도 제거 (예: <tool_, <tool_ca 등)
      content = content.replace(/<tool_[a-z]*$/gi, '');
      content = content.replace(/<\\/tool_[a-z]*$/gi, '');

      // 내부 태그도 제거 (<name>, <parameters> 등 - 혹시 별도로 나타날 경우)
      content = content.replace(/<name>[\\s\\S]*?<\\/name>/g, '');
      content = content.replace(/<parameters>[\\s\\S]*?<\\/parameters>/g, '');
      content = content.replace(/<name>[\\s\\S]*$/g, '');
      content = content.replace(/<parameters>[\\s\\S]*$/g, '');
      content = content.replace(/<\\/?name>?$/gi, '');
      content = content.replace(/<\\/?parameters>?$/gi, '');

      // 연속된 빈 줄 정리 (3개 이상의 줄바꿈을 2개로)
      content = content.replace(/\\n{3,}/g, '\\n\\n');

      // 정리 후 앞뒤 공백 제거
      content = content.trim();

      // 코드 블록을 헤더가 있는 형태로 변환
      content = content.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
        return \`<div class="code-block">
          <div class="code-block-header">
            <button class="code-block-copy" onclick="copyCode(this)" title="Copy">
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M4 4h1V3H3.5a.5.5 0 00-.5.5V5h1V4zm7 0V3H6v1h5zM4 11H3v1.5a.5.5 0 00.5.5H5v-1H4v-1zm8 0v1h-1v1h1.5a.5.5 0 00.5-.5V11h-1zm0-7h1v6h-1V4zm-8 6H3V5h1v5zM5 13v-1h6v1H5zm7-10v1h1v1h1V3.5a.5.5 0 00-.5-.5H12zM3.5 3a.5.5 0 00-.5.5V5h1V4h1V3H3.5z" fill-rule="evenodd" clip-rule="evenodd"/>
              </svg>
            </button>
          </div>
          <pre><code>\${escapeHtml(code)}</code></pre>
        </div>\`;
      });

      // 인라인 코드
      content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // 줄바꿈
      content = content.replace(/\\n/g, '<br>');

      return content;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function copyCode(btn) {
      const codeBlock = btn.closest('.code-block');
      const code = codeBlock.querySelector('code').textContent;
      const originalSvg = btn.innerHTML;
      navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btn.style.color = 'var(--vscode-testing-iconPassed)';
        setTimeout(() => {
          btn.innerHTML = originalSvg;
          btn.style.color = '';
        }, 2000);
      });
    }
    window.copyCode = copyCode;

    function scrollToBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function autoResize() {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
    }

    function sendMessage(text) {
      const msgText = text || messageInput.value.trim();
      if (!msgText || isStreaming) return;

      isStreaming = true;
      sendBtn.disabled = true;
      messageInput.value = '';
      autoResize();

      vscode.postMessage({ type: 'sendMessage', text: msgText });
    }

    sendBtn.addEventListener('click', () => sendMessage());

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    messageInput.addEventListener('input', autoResize);

    modelSelect.addEventListener('change', (e) => {
      vscode.postMessage({ type: 'changeModel', model: e.target.value });
    });

    suggestionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        sendMessage(prompt);
      });
    });

    window.addEventListener('message', (event) => {
      const data = event.data;

      switch (data.type) {
        case 'loadMessages':
          messages = data.messages || [];
          renderMessages();
          break;

        case 'addMessage':
          messages.push(data.message);
          emptyState.style.display = 'none';
          const messageEl = createMessageElement(data.message);
          messagesContainer.appendChild(messageEl);
          scrollToBottom();
          break;

        case 'appendToken':
          const contentEl = document.getElementById('content-' + data.messageId);
          if (contentEl) {
            const msg = messages.find(m => m.id === data.messageId);
            if (msg) {
              msg.content += data.token;
              // Task 블록이 있으면 덮어쓰지 않음
              const existingTaskBlock = contentEl.querySelector('.task-block');
              if (!existingTaskBlock) {
                contentEl.innerHTML = formatContent(msg.content) + '<span class="streaming-indicator"><span class="streaming-dot"></span><span class="streaming-dot"></span><span class="streaming-dot"></span></span>';
              }
              scrollToBottom();
            }
          }
          break;

        case 'completeMessage':
          const completedMsg = messages.find(m => m.id === data.messageId);
          if (completedMsg) {
            completedMsg.isStreaming = false;
            const el = document.getElementById('content-' + data.messageId);
            if (el) {
              // Task 블록을 보존하면서 최종 텍스트만 추가
              const existingTaskBlock = el.querySelector('.task-block');
              const streamingIndicator = el.querySelector('.streaming-indicator');
              if (streamingIndicator) {
                streamingIndicator.remove();
              }

              // Task 블록이 있으면 그 뒤에 최종 응답 추가
              if (existingTaskBlock) {
                // 최종 텍스트가 있으면 Task 블록 뒤에 추가
                const finalText = formatContent(completedMsg.content);
                if (finalText.trim()) {
                  const responseDiv = document.createElement('div');
                  responseDiv.className = 'final-response';
                  responseDiv.innerHTML = finalText;
                  el.appendChild(responseDiv);
                }
              } else {
                // Task 블록이 없으면 일반적으로 렌더링
                el.innerHTML = formatContent(completedMsg.content);
              }
            }
          }
          isStreaming = false;
          sendBtn.disabled = false;
          messageInput.focus();
          break;

        case 'clearMessages':
          messages = [];
          renderMessages();
          break;

        case 'setInput':
          messageInput.value = data.text;
          autoResize();
          messageInput.focus();
          break;

        case 'error':
          isStreaming = false;
          sendBtn.disabled = false;
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
            lastMsg.content = '오류가 발생했습니다: ' + data.message;
            lastMsg.isStreaming = false;
            const errEl = document.getElementById('content-' + lastMsg.id);
            if (errEl) {
              errEl.innerHTML = formatContent(lastMsg.content);
            }
          }
          break;

        case 'config':
          modelSelect.innerHTML = '';
          (data.models || []).forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === data.model) {
              option.selected = true;
            }
            modelSelect.appendChild(option);
          });
          break;

        case 'taskStart':
          // Task 블록을 현재 스트리밍 중인 AI 메시지 내부에 생성
          // 이미 Task 블록이 있으면 재사용 (하나의 통합 타임라인 유지)
          const lastAssistantMsg = messagesContainer.querySelector('.message.assistant:last-child');
          if (lastAssistantMsg) {
            const contentEl = lastAssistantMsg.querySelector('.message-content');
            if (contentEl) {
              // 이미 Task 블록이 있는지 확인
              let existingTask = contentEl.querySelector('.task-block');
              if (existingTask) {
                // 이미 있으면 computing 상태만 다시 보여주기
                let computingEl = existingTask.querySelector('.computing-status');
                if (!computingEl) {
                  const taskBody = existingTask.querySelector('.task-body');
                  if (taskBody) {
                    computingEl = document.createElement('div');
                    computingEl.className = 'computing-status';
                    computingEl.innerHTML = '<span class="timely-spinner"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#a78bfa" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></span><span class="computing-text">Working<span class="computing-dots"><span></span><span></span><span></span></span></span>';
                    taskBody.appendChild(computingEl);
                  }
                }
                scrollToBottom();
                break;
              }

              // 기존 스트리밍 인디케이터 제거
              const existingIndicator = contentEl.querySelector('.streaming-indicator');
              if (existingIndicator) {
                existingIndicator.remove();
              }

              const taskBlock = document.createElement('div');
              taskBlock.className = 'task-block';
              taskBlock.id = 'task-' + data.taskId;
              taskBlock.innerHTML = \`
                <div class="task-header">
                  <span class="task-icon">✦</span>
                  <span class="task-title">Task: \${escapeHtml(data.title)}</span>
                </div>
                <div class="task-body">
                  <div class="task-tools"></div>
                  <div class="computing-status">
                    <span class="timely-spinner"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#a78bfa" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></span>
                    <span class="computing-text">Working<span class="computing-dots"><span></span><span></span><span></span></span></span>
                  </div>
                </div>
              \`;
              contentEl.appendChild(taskBlock);
            }
          }
          scrollToBottom();
          break;

        case 'taskComplete':
          // Task 완료 처리 - computing만 제거, completed 클래스는 추가하지 않음
          const completedTask = document.getElementById('task-' + data.taskId);
          if (completedTask) {
            const computingEl = completedTask.querySelector('.computing-status');
            if (computingEl) {
              computingEl.remove();
            }
          }
          break;

        case 'toolCallStart':
          // 현재 AI 메시지 내에서 Task 블록 찾기 (completed 여부 상관없이)
          const currentAssistantMsg = messagesContainer.querySelector('.message.assistant:last-child');
          let taskContainer = currentAssistantMsg ? currentAssistantMsg.querySelector('.task-block') : null;

          if (!taskContainer && currentAssistantMsg) {
            // Task 블록이 없으면 메시지 내에 생성
            const msgContent = currentAssistantMsg.querySelector('.message-content');
            if (msgContent) {
              // 기존 스트리밍 인디케이터 제거
              const existingIndicator = msgContent.querySelector('.streaming-indicator');
              if (existingIndicator) {
                existingIndicator.remove();
              }

              taskContainer = document.createElement('div');
              taskContainer.className = 'task-block';
              taskContainer.id = 'task-auto-' + Date.now();
              taskContainer.innerHTML = \`
                <div class="task-header">
                  <span class="task-icon">✦</span>
                  <span class="task-title">Task: 코드 탐색 중</span>
                </div>
                <div class="task-body">
                  <div class="task-tools"></div>
                  <div class="computing-status">
                    <span class="timely-spinner"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#a78bfa" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></span>
                    <span class="computing-text">Working<span class="computing-dots"><span></span><span></span><span></span></span></span>
                  </div>
                </div>
              \`;
              msgContent.appendChild(taskContainer);
            }
          }

          if (taskContainer) {
            // computing 상태가 없으면 추가
            let computingEl = taskContainer.querySelector('.computing-status');
            if (!computingEl) {
              const taskBody = taskContainer.querySelector('.task-body');
              if (taskBody) {
                computingEl = document.createElement('div');
                computingEl.className = 'computing-status';
                computingEl.innerHTML = '<span class="timely-spinner"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#a78bfa" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></span><span class="computing-text">Working<span class="computing-dots"><span></span><span></span><span></span></span></span>';
                taskBody.appendChild(computingEl);
              }
            }

            // 도구 항목 추가 (기존 타임라인에 계속 추가)
            const taskTools = taskContainer.querySelector('.task-tools');
            const toolItemEl = document.createElement('div');
            toolItemEl.className = 'tool-item running';
            toolItemEl.id = 'tool-' + data.toolCall.id;

            // 도구 타입과 상세 정보 분리
            const toolInfo = formatToolInfo(data.toolCall);
            toolItemEl.innerHTML = \`
              <div class="tool-info">
                <div class="tool-info-row">
                  <span class="tool-type"><span class="tool-type-icon">\${toolInfo.icon}</span> \${toolInfo.type}</span>
                </div>
                <div class="tool-detail">\${toolInfo.detail}</div>
              </div>
            \`;
            taskTools.appendChild(toolItemEl);
          }

          scrollToBottom();
          break;

        case 'toolCallComplete':
          // 도구 실행 완료 표시
          const toolEl = document.getElementById('tool-' + data.result.toolCallId);
          if (toolEl) {
            // 상태 클래스 업데이트
            toolEl.classList.remove('running');
            toolEl.classList.add(data.result.success ? 'success' : 'error');

            // 결과 표시
            const infoEl = toolEl.querySelector('.tool-info');
            if (infoEl && data.description) {
              const resultEl = document.createElement('div');
              resultEl.className = 'tool-result' + (data.result.success ? '' : ' error');
              resultEl.textContent = data.description;
              infoEl.appendChild(resultEl);
            }
            // 스피너는 taskComplete에서만 제거 - 도구 완료 후에도 AI가 다음 작업 준비 중이므로 계속 표시
          }
          break;

        case 'showDiff':
          // Diff 표시 (편집 승인용)
          const diffEl = document.createElement('div');
          diffEl.className = 'diff-block';
          diffEl.innerHTML = \`
            <div class="diff-header">📝 \${data.path} 변경 사항</div>
            <pre class="diff-content">\${escapeHtml(data.diff)}</pre>
            <div class="diff-actions">
              <button class="diff-btn apply-btn" onclick="applyEdit('\${data.path}')">적용</button>
              <button class="diff-btn reject-btn" onclick="rejectEdit(this)">취소</button>
            </div>
          \`;
          diffEl.dataset.path = data.path;
          diffEl.dataset.newContent = data.newContent;
          messagesContainer.appendChild(diffEl);
          scrollToBottom();
          break;

        case 'editApplied':
          // 편집 적용 완료
          const appliedDiff = document.querySelector(\`.diff-block[data-path="\${data.path}"]\`);
          if (appliedDiff) {
            appliedDiff.querySelector('.diff-actions').innerHTML = '<span class="applied-badge">✓ 적용됨</span>';
          }
          break;
      }
    });

    // 편집 적용 함수
    function applyEdit(path) {
      const diffBlock = document.querySelector(\`.diff-block[data-path="\${path}"]\`);
      if (diffBlock) {
        const newContent = diffBlock.dataset.newContent;
        vscode.postMessage({ type: 'applyEdit', path, newContent });
      }
    }
    window.applyEdit = applyEdit;

    // 편집 취소 함수
    function rejectEdit(btn) {
      const diffBlock = btn.closest('.diff-block');
      if (diffBlock) {
        diffBlock.querySelector('.diff-actions').innerHTML = '<span class="rejected-badge">✗ 취소됨</span>';
      }
    }
    window.rejectEdit = rejectEdit;

    // 파일 열기 함수
    function openFile(path) {
      vscode.postMessage({ type: 'openFile', path });
    }
    window.openFile = openFile;

    // 도구 그룹 접기/펼치기
    function toggleToolGroup(header) {
      const group = header.closest('.tool-group');
      if (group) {
        group.classList.toggle('collapsed');
      }
    }
    window.toggleToolGroup = toggleToolGroup;

    // 도구 정보 포맷팅 (Claude Code 스타일 + 아이콘)
    function formatToolInfo(toolCall) {
      const params = toolCall.parameters || {};
      switch (toolCall.name) {
        case 'search_files':
          return {
            icon: '🔍',
            type: 'Search',
            detail: \`<code>"\${escapeHtml(params.query || '')}"</code>\` +
                   (params.filePattern ? \` <span class="tool-param">pattern:</span> <code>\${escapeHtml(params.filePattern)}</code>\` : '') +
                   (params.path ? \` <span class="tool-param">in:</span> <code>\${escapeHtml(params.path)}</code>\` : '')
          };
        case 'list_files':
          return {
            icon: '📂',
            type: 'Glob',
            detail: \`<code>"\${escapeHtml(params.pattern || '*')}"</code>\` +
                   (params.directory ? \` <span class="tool-param">in:</span> <code>\${escapeHtml(params.directory)}</code>\` : '')
          };
        case 'read_file':
          return {
            icon: '📄',
            type: 'Read',
            detail: \`<code>\${escapeHtml(params.path || '')}</code>\` +
                   (params.startLine ? \` <span class="tool-param">lines</span> \${params.startLine}-\${params.endLine || 'end'}\` : '')
          };
        case 'write_file':
          return {
            icon: '✏️',
            type: 'Write',
            detail: \`<code>\${escapeHtml(params.path || '')}</code>\`
          };
        case 'edit_file':
          return {
            icon: '🔧',
            type: 'Edit',
            detail: \`<code>\${escapeHtml(params.path || '')}</code>\`
          };
        default:
          return {
            icon: '⚡',
            type: toolCall.name,
            detail: JSON.stringify(params)
          };
      }
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
