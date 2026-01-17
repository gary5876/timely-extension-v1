import * as vscode from 'vscode';
import { getExtensionConfig } from '../utils/config';

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
        }
      },
      null,
      this._disposables
    );
  }

  private async _handleSendMessage(text: string) {
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
    this._panel.webview.postMessage({ type: 'addMessage', message: userMessage });

    // AI 응답 placeholder 추가
    const assistantMessage = createMessage('assistant', '', true);
    messages.push(assistantMessage);
    this._panel.webview.postMessage({ type: 'addMessage', message: assistantMessage });

    // 스트리밍 응답
    await sendMessageStream(this._sessionId, text, {
      model: config.model,
      instructions: config.instructions,
      onToken: (token) => {
        this._panel.webview.postMessage({
          type: 'appendToken',
          messageId: assistantMessage.id,
          token,
        });
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
      font-size: var(--vscode-font-size);
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
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .header-title {
      font-weight: 600;
      font-size: 14px;
    }

    .model-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      max-width: 150px;
    }

    .model-select:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* 메시지 영역 */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .message {
      margin-bottom: 24px;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-role {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }

    .message-role.user {
      color: var(--vscode-textLink-foreground);
    }

    .message-role.assistant {
      color: var(--vscode-gitDecoration-addedResourceForeground, #4ec9b0);
    }

    .message-content {
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* 코드 블록 */
    .message-content code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    .message-content pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }

    .message-content pre code {
      background: transparent;
      padding: 0;
    }

    /* 스트리밍 커서 */
    .streaming-cursor {
      display: inline-block;
      width: 8px;
      height: 16px;
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
      padding: 16px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .input-container {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .input-wrapper {
      flex: 1;
      position: relative;
    }

    textarea {
      width: 100%;
      min-height: 44px;
      max-height: 200px;
      padding: 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
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
      padding: 12px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      white-space: nowrap;
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
      padding: 40px;
    }

    .empty-state h2 {
      font-size: 18px;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }

    .empty-state p {
      font-size: 13px;
      opacity: 0.8;
    }

    /* 에러 메시지 */
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-title">Timely Chat</span>
    <div class="header-actions">
      <select class="model-select" id="modelSelect">
        <option>로딩중...</option>
      </select>
    </div>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <h2>Timely Chat</h2>
      <p>메시지를 입력하여 대화를 시작하세요</p>
    </div>
  </div>

  <div class="input-area">
    <div class="input-container">
      <div class="input-wrapper">
        <textarea
          id="messageInput"
          placeholder="메시지를 입력하세요... (Shift+Enter로 줄바꿈)"
          rows="1"
        ></textarea>
      </div>
      <button class="send-btn" id="sendBtn">전송</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const modelSelect = document.getElementById('modelSelect');

    let messages = [];
    let isStreaming = false;

    // 메시지 렌더링
    function renderMessages() {
      if (messages.length === 0) {
        emptyState.style.display = 'flex';
        return;
      }

      emptyState.style.display = 'none';

      // 기존 메시지 제거 (emptyState 제외)
      const existingMessages = messagesContainer.querySelectorAll('.message');
      existingMessages.forEach(el => el.remove());

      messages.forEach(msg => {
        const messageEl = createMessageElement(msg);
        messagesContainer.appendChild(messageEl);
      });

      scrollToBottom();
    }

    // 메시지 요소 생성
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

    // 컨텐츠 포맷팅 (마크다운 간단 처리)
    function formatContent(content) {
      if (!content) return '';

      // 코드 블록
      content = content.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
      // 인라인 코드
      content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // 줄바꿈
      content = content.replace(/\\n/g, '<br>');

      return content;
    }

    // 스크롤 맨 아래로
    function scrollToBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // 메시지 전송
    function sendMessage() {
      const text = messageInput.value.trim();
      if (!text || isStreaming) return;

      isStreaming = true;
      sendBtn.disabled = true;
      messageInput.value = '';
      autoResize();

      vscode.postMessage({ type: 'sendMessage', text });
    }

    // 텍스트영역 자동 높이 조절
    function autoResize() {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
    }

    // 이벤트 리스너
    sendBtn.addEventListener('click', sendMessage);

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

    // Extension 메시지 수신
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

        case 'setInput':
          messageInput.value = data.text;
          autoResize();
          messageInput.focus();
          break;

        case 'error':
          isStreaming = false;
          sendBtn.disabled = false;
          // 에러 메시지가 있는 assistant 메시지 업데이트
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
            lastMsg.content = '⚠️ 오류가 발생했습니다: ' + data.message;
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

    // 준비 완료 알림
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
