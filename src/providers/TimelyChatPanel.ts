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
      overflow: hidden;
      background: var(--vscode-textCodeBlock-background);
    }

    .code-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: rgba(0,0,0,0.2);
      font-size: 12px;
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
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      transition: all 0.15s ease;
    }

    .code-block-copy:hover {
      background: rgba(255,255,255,0.1);
      color: var(--vscode-foreground);
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
