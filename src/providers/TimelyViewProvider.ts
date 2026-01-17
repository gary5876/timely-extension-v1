import * as vscode from 'vscode';
import { getExtensionConfig } from '../utils/config';

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
      }
    });
  }

  private async _handleSendMessage(text: string) {
    if (!this._view) return;

    const config = getExtensionConfig();
    const { initializeClient, isClientInitialized, sendMessageStream, createMessage } = await import('../services/chatService');
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

    // 스트리밍 응답
    await sendMessageStream(this._sessionId, text, {
      model: config.model,
      instructions: config.instructions,
      onToken: (token) => {
        this._view?.webview.postMessage({
          type: 'appendToken',
          messageId: assistantMessage.id,
          token,
        });
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
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* 헤더 */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .header-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
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
      padding: 4px;
      border-radius: 3px;
      cursor: pointer;
      opacity: 0.7;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .icon-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      opacity: 1;
    }

    .icon-btn[title]:hover::after {
      content: attr(title);
    }

    .model-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 3px;
      padding: 2px 4px;
      font-size: 10px;
      cursor: pointer;
      outline: none;
      max-width: 90px;
    }

    .model-select:focus {
      border-color: var(--vscode-focusBorder);
    }

    /* 메시지 영역 */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .message {
      margin-bottom: 16px;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-role {
      font-weight: 600;
      font-size: 11px;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .message-role.user {
      color: var(--vscode-textLink-foreground);
    }

    .message-role.assistant {
      color: var(--vscode-gitDecoration-addedResourceForeground, #4ec9b0);
    }

    .message-content {
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message-content code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    .message-content pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 6px 0;
    }

    .message-content pre code {
      background: transparent;
      padding: 0;
    }

    /* 스트리밍 커서 */
    .streaming-cursor {
      display: inline-block;
      width: 6px;
      height: 14px;
      background: var(--vscode-editorCursor-foreground);
      animation: blink 1s infinite;
      vertical-align: middle;
      margin-left: 2px;
    }

    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }

    /* 입력 영역 */
    .input-area {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .input-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    textarea {
      width: 100%;
      min-height: 60px;
      max-height: 150px;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      resize: none;
      outline: none;
    }

    textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .send-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      align-self: flex-end;
    }

    .send-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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
      padding: 20px;
    }

    .empty-state p {
      font-size: 12px;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">Chat</span>
      <select class="model-select" id="modelSelect" title="모델 선택"></select>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="newChatBtn" title="새 대화 (Ctrl+Alt+N)">+</button>
      <button class="icon-btn" id="openEditorBtn" title="새 창에서 열기 (Ctrl+Alt+C)">⧉</button>
      <button class="icon-btn" id="closeBtn" title="닫기">×</button>
    </div>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <p>메시지를 입력하여<br>대화를 시작하세요</p>
    </div>
  </div>

  <div class="input-area">
    <div class="input-container">
      <textarea
        id="messageInput"
        placeholder="메시지 입력... (Enter로 전송)"
        rows="2"
      ></textarea>
      <button class="send-btn" id="sendBtn">전송</button>
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
    const closeBtn = document.getElementById('closeBtn');
    const modelSelect = document.getElementById('modelSelect');

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
      div.className = 'message';
      div.id = 'msg-' + msg.id;

      const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
      const roleClass = msg.role;

      div.innerHTML = \`
        <div class="message-role \${roleClass}">\${roleLabel}</div>
        <div class="message-content" id="content-\${msg.id}">\${formatContent(msg.content)}\${msg.isStreaming ? '<span class="streaming-cursor"></span>' : ''}</div>
      \`;

      return div;
    }

    function formatContent(content) {
      if (!content) return '';
      content = content.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
      content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      content = content.replace(/\\n/g, '<br>');
      return content;
    }

    function scrollToBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function sendMessage() {
      const text = messageInput.value.trim();
      if (!text || isStreaming) return;

      isStreaming = true;
      sendBtn.disabled = true;
      messageInput.value = '';

      vscode.postMessage({ type: 'sendMessage', text });
    }

    sendBtn.addEventListener('click', sendMessage);

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    newChatBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'newChat' });
    });

    openEditorBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openInEditor' });
    });

    closeBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });

    modelSelect.addEventListener('change', (e) => {
      vscode.postMessage({ type: 'changeModel', model: e.target.value });
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
              contentEl.innerHTML = formatContent(msg.content) + '<span class="streaming-cursor"></span>';
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

        case 'error':
          isStreaming = false;
          sendBtn.disabled = false;
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
            lastMsg.content = '⚠️ ' + data.message;
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
      }
    });

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
