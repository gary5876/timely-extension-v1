import * as vscode from 'vscode';
import { getExtensionConfig } from '../utils/config';
import type { ToolCall, ToolResult, EditResult } from '../types/tools';
import { applyEdit } from '../services/fileService';
import { describeToolCall, formatToolResultForDisplay } from '../services/toolParser';

/**
 * 사이드바 채팅 (Claude Code 스타일)
 */
export class TimelyViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'timely-chat.sidebarView';

  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  private _sessionId: string = '';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this._context = context;
    // 사이드바는 하나의 세션 사용
    const { getSessionId } = require('../utils/session');
    this._sessionId = getSessionId(context);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // WebView 메시지 핸들러
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'sendMessage':
          await this._handleSendMessage(message.text);
          break;
        case 'newChat':
          await this._handleNewChat();
          break;
        case 'ready':
          await this._loadMessages();
          await this._sendConfig();
          break;
        case 'changeModel':
          await this._handleChangeModel(message.model);
          break;
        case 'openInEditor':
          await vscode.commands.executeCommand('timely-chat.openChat');
          break;
        case 'close':
          await vscode.commands.executeCommand('workbench.action.closeSidebar');
          break;
        case 'applyEdit':
          await this._handleApplyEdit(message.path, message.newContent);
          break;
        case 'openFile':
          await this._handleOpenFile(message.path);
          break;
      }
    });
  }

  private async _handleApplyEdit(filePath: string, newContent: string) {
    const success = await applyEdit(filePath, newContent);
    if (success) {
      vscode.window.showInformationMessage(`파일이 수정되었습니다: ${filePath}`);
      this._view?.webview.postMessage({ type: 'editApplied', path: filePath });
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
    if (!this._view) return;

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
    this._view.webview.postMessage({ type: 'addMessage', message: userMessage });

    // AI 응답 placeholder 추가
    const assistantMessage = createMessage('assistant', '', true);
    messages.push(assistantMessage);
    this._view.webview.postMessage({ type: 'addMessage', message: assistantMessage });

    // 도구 지원 스트리밍 응답
    await sendMessageWithTools(this._sessionId, text, {
      model: config.model,
      instructions: config.instructions,
      enableTools: true,
      onToken: (token) => {
        this._view?.webview.postMessage({
          type: 'appendToken',
          messageId: assistantMessage.id,
          token,
        });
      },
      onToolCall: (toolCall: ToolCall) => {
        this._view?.webview.postMessage({
          type: 'toolCallStart',
          toolCall,
          description: describeToolCall(toolCall),
        });
      },
      onToolResult: (result: ToolResult) => {
        this._view?.webview.postMessage({
          type: 'toolCallComplete',
          result,
          description: formatToolResultForDisplay(result),
        });

        if (result.toolName === 'edit_file' && result.success && result.result) {
          const editResult = result.result as EditResult;
          this._view?.webview.postMessage({
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
        this._view?.webview.postMessage({
          type: 'completeMessage',
          messageId: assistantMessage.id,
        });
        await saveSessionMessages(this._context, this._sessionId, messages);
      },
      onError: (error) => {
        this._view?.webview.postMessage({
          type: 'error',
          message: error.message,
        });
        vscode.window.showErrorMessage(`Timely Chat: ${error.message}`);
      },
    });
  }

  private async _handleNewChat() {
    const { createNewSession } = await import('../utils/session');
    const newSession = createNewSession(this._context);
    this._sessionId = newSession.id;
    this._view?.webview.postMessage({ type: 'clearMessages' });
  }

  private async _loadMessages() {
    const { loadSessionMessages } = await import('../utils/session');
    const messages = loadSessionMessages(this._context, this._sessionId);
    this._view?.webview.postMessage({ type: 'loadMessages', messages });
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
    this._view?.webview.postMessage({
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

  public async refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
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
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      min-height: 44px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-foreground);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      opacity: 0.7;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: all 0.15s ease;
    }

    .icon-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      opacity: 1;
    }

    .model-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      outline: none;
      max-width: 120px;
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
      padding: 16px 20px;
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
      gap: 8px;
      margin-bottom: 8px;
    }

    .message-avatar {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
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
      font-size: 13px;
      color: var(--vscode-foreground);
    }

    .message-content {
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      padding-left: 32px;
    }

    .message-content p {
      margin-bottom: 12px;
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
      font-size: 12px;
    }

    .code-block {
      position: relative;
      margin: 12px 0;
      border-radius: 8px;
      overflow: hidden;
      background: var(--vscode-textCodeBlock-background);
    }

    .code-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: rgba(0,0,0,0.2);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .code-block-lang {
      text-transform: lowercase;
    }

    .code-block-copy {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      transition: all 0.15s ease;
    }

    .code-block-copy:hover {
      background: rgba(255,255,255,0.1);
      color: var(--vscode-foreground);
    }

    .message-content pre {
      margin: 0;
      padding: 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
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
      width: 4px;
      height: 4px;
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

    /* 도구 호출 그룹 */
    .tool-group {
      margin: 8px 16px;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 6px;
      overflow: hidden;
    }

    .tool-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      cursor: pointer;
      background: rgba(0,0,0,0.1);
      font-size: 11px;
    }

    .tool-group-toggle {
      font-size: 9px;
      transition: transform 0.2s ease;
    }

    .tool-group.collapsed .tool-group-toggle {
      transform: rotate(-90deg);
    }

    .tool-group-title {
      flex: 1;
      color: var(--vscode-descriptionForeground);
    }

    .tool-group-count {
      font-size: 10px;
      background: rgba(255,255,255,0.1);
      padding: 1px 6px;
      border-radius: 8px;
    }

    .tool-group-items {
      max-height: 400px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .tool-group.collapsed .tool-group-items {
      max-height: 0;
    }

    .tool-call {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-top: 1px solid rgba(255,255,255,0.05);
      font-size: 11px;
    }

    .tool-call:first-child { border-top: none; }

    .tool-icon { font-size: 12px; width: 16px; text-align: center; }

    .tool-name {
      flex: 1;
      color: var(--vscode-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tool-status { font-size: 11px; font-weight: 600; }

    .tool-status.spinner {
      width: 10px;
      height: 10px;
      border: 2px solid var(--vscode-textLink-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .tool-status.success { color: var(--vscode-testing-iconPassed); }
    .tool-status.error { color: var(--vscode-testing-iconFailed); }

    @keyframes spin { to { transform: rotate(360deg); } }

    .diff-block {
      margin: 8px 16px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 6px;
      overflow: hidden;
    }

    .diff-header {
      padding: 8px 12px;
      background: rgba(0,0,0,0.2);
      font-size: 11px;
      font-weight: 600;
    }

    .diff-content {
      margin: 0;
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.4;
      overflow-x: auto;
      white-space: pre;
    }

    .diff-actions {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      background: rgba(0,0,0,0.1);
    }

    .diff-btn {
      padding: 4px 12px;
      border: none;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }

    .apply-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .reject-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .applied-badge, .rejected-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
    }

    .applied-badge { background: var(--vscode-testing-iconPassed); color: white; }
    .rejected-badge { background: var(--vscode-descriptionForeground); color: white; }

    /* 입력 영역 */
    .input-area {
      padding: 16px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }

    .input-container {
      position: relative;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 12px;
      padding: 8px 12px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .input-container:focus-within {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }

    textarea {
      flex: 1;
      min-height: 24px;
      max-height: 120px;
      padding: 4px 0;
      border: none;
      background: transparent;
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px;
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
      width: 32px;
      height: 32px;
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
      width: 16px;
      height: 16px;
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
      padding: 32px 20px;
    }

    .empty-state-icon {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 8px;
    }

    .empty-state p {
      font-size: 12px;
      opacity: 0.8;
      line-height: 1.5;
    }

    .suggestions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 20px;
      width: 100%;
      max-width: 280px;
    }

    .suggestion-btn {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-foreground);
      padding: 10px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      text-align: left;
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
      <select class="model-select" id="modelSelect" title="모델 선택"></select>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="newChatBtn" title="새 대화">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
        </svg>
      </button>
      <button class="icon-btn" id="openEditorBtn" title="새 창에서 열기">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10 2h4v4M6 10l8-8M14 9v5a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h3>Timely Chat</h3>
      <p>AI와 대화를 시작해보세요</p>
      <div class="suggestions">
        <button class="suggestion-btn" data-prompt="이 코드를 설명해줘">"이 코드를 설명해줘"</button>
        <button class="suggestion-btn" data-prompt="버그를 찾아줘">"버그를 찾아줘"</button>
        <button class="suggestion-btn" data-prompt="리팩토링 제안해줘">"리팩토링 제안해줘"</button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-container">
      <textarea
        id="messageInput"
        placeholder="메시지를 입력하세요..."
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
    const newChatBtn = document.getElementById('newChatBtn');
    const openEditorBtn = document.getElementById('openEditorBtn');
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

      // 코드 블록을 헤더가 있는 형태로 변환
      content = content.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
        const language = lang || 'code';
        return \`<div class="code-block">
          <div class="code-block-header">
            <span class="code-block-lang">\${language}</span>
            <button class="code-block-copy" onclick="copyCode(this)">Copy</button>
          </div>
          <pre><code>\${escapeHtml(code)}</code></pre>
        </div>\`;
      });

      // 인라인 코드
      content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // 줄바꿈 (코드 블록 외부만)
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
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }
    window.copyCode = copyCode;

    function scrollToBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function autoResize() {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
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

    newChatBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'newChat' });
    });

    openEditorBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openInEditor' });
    });

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
              contentEl.innerHTML = formatContent(msg.content) + '<span class="streaming-indicator"><span class="streaming-dot"></span><span class="streaming-dot"></span><span class="streaming-dot"></span></span>';
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
              el.innerHTML = formatContent(completedMsg.content);
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

        case 'toolCallStart':
          // 도구 그룹 컨테이너 찾기 또는 생성
          let toolGroup = messagesContainer.querySelector('.tool-group:last-child:not(.completed)');
          if (!toolGroup) {
            toolGroup = document.createElement('div');
            toolGroup.className = 'tool-group';
            toolGroup.innerHTML = \`
              <div class="tool-group-header" onclick="toggleToolGroup(this)">
                <span class="tool-group-toggle">▼</span>
                <span class="tool-group-title">도구 실행 중...</span>
                <span class="tool-group-count">0</span>
              </div>
              <div class="tool-group-items"></div>
            \`;
            messagesContainer.appendChild(toolGroup);
          }

          const toolItems = toolGroup.querySelector('.tool-group-items');
          const toolCallEl = document.createElement('div');
          toolCallEl.className = 'tool-call';
          toolCallEl.id = 'tool-' + data.toolCall.id;
          toolCallEl.innerHTML = \`
            <span class="tool-icon">⚙️</span>
            <span class="tool-name">\${data.description}</span>
            <span class="tool-status spinner"></span>
          \`;
          toolItems.appendChild(toolCallEl);

          const countEl = toolGroup.querySelector('.tool-group-count');
          countEl.textContent = toolItems.children.length;

          scrollToBottom();
          break;

        case 'toolCallComplete':
          const toolEl = document.getElementById('tool-' + data.result.toolCallId);
          if (toolEl) {
            const statusEl = toolEl.querySelector('.tool-status');
            if (statusEl) {
              statusEl.className = 'tool-status ' + (data.result.success ? 'success' : 'error');
              statusEl.textContent = data.result.success ? '✓' : '✗';
            }

            const parentGroup = toolEl.closest('.tool-group');
            if (parentGroup) {
              const spinners = parentGroup.querySelectorAll('.tool-status.spinner');
              if (spinners.length === 0) {
                parentGroup.classList.add('completed', 'collapsed');
                const titleEl = parentGroup.querySelector('.tool-group-title');
                const itemCount = parentGroup.querySelectorAll('.tool-call').length;
                const successCount = parentGroup.querySelectorAll('.tool-status.success').length;
                titleEl.textContent = \`\${itemCount}개 도구 실행 완료 (\${successCount} 성공)\`;
              }
            }
          }
          break;

        case 'showDiff':
          const diffEl = document.createElement('div');
          diffEl.className = 'diff-block';
          diffEl.innerHTML = \`
            <div class="diff-header">📝 \${data.path}</div>
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
          const appliedDiff = document.querySelector(\`.diff-block[data-path="\${data.path}"]\`);
          if (appliedDiff) {
            appliedDiff.querySelector('.diff-actions').innerHTML = '<span class="applied-badge">✓ 적용됨</span>';
          }
          break;
      }
    });

    function applyEdit(path) {
      const diffBlock = document.querySelector(\`.diff-block[data-path="\${path}"]\`);
      if (diffBlock) {
        const newContent = diffBlock.dataset.newContent;
        vscode.postMessage({ type: 'applyEdit', path, newContent });
      }
    }
    window.applyEdit = applyEdit;

    function rejectEdit(btn) {
      const diffBlock = btn.closest('.diff-block');
      if (diffBlock) {
        diffBlock.querySelector('.diff-actions').innerHTML = '<span class="rejected-badge">✗ 취소됨</span>';
      }
    }
    window.rejectEdit = rejectEdit;

    function openFile(path) {
      vscode.postMessage({ type: 'openFile', path });
    }
    window.openFile = openFile;

    function toggleToolGroup(header) {
      const group = header.closest('.tool-group');
      if (group) {
        group.classList.toggle('collapsed');
      }
    }
    window.toggleToolGroup = toggleToolGroup;

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
