import * as vscode from 'vscode';
import { ExtensionConfig, ChatGroup, CDN_URL } from '../types';

/**
 * Manages the webview panel for the editor chat
 */
export class TimelyChatPanel {
  public static currentPanel: TimelyChatPanel | undefined;
  public static readonly viewType = 'timelyChat';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _token: string;
  private _config: ExtensionConfig;

  public static createOrShow(extensionUri: vscode.Uri, token: string, config: ExtensionConfig) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (TimelyChatPanel.currentPanel) {
      TimelyChatPanel.currentPanel._panel.reveal(column);
      TimelyChatPanel.currentPanel._token = token;
      TimelyChatPanel.currentPanel._config = config;
      TimelyChatPanel.currentPanel.refresh();
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      TimelyChatPanel.viewType,
      'Timely Chat',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    );

    TimelyChatPanel.currentPanel = new TimelyChatPanel(panel, extensionUri, token, config);
  }

  public static kill() {
    TimelyChatPanel.currentPanel?.dispose();
    TimelyChatPanel.currentPanel = undefined;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    token: string,
    config: ExtensionConfig
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._token = token;
    this._config = config;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case 'error':
            vscode.window.showErrorMessage(message.message);
            break;
          case 'info':
            vscode.window.showInformationMessage(message.message);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public toggleChatbot() {
    this._panel.webview.postMessage({ type: 'toggle-chatbot' });
  }

  public openChat(groups: ChatGroup[], instructions?: string) {
    this._panel.webview.postMessage({
      type: 'open-chat',
      groups,
      instructions,
    });
  }

  public closeChat() {
    this._panel.webview.postMessage({ type: 'close-chat' });
  }

  public sendMessage(message: string, code?: { language: string; content: string; fileName?: string }) {
    this._panel.webview.postMessage({
      type: 'send-message',
      message,
      code,
    });
  }

  public refresh() {
    this._update();
  }

  public dispose() {
    TimelyChatPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; connect-src https:;">
  <title>Timely Chat</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    #chat-container {
      width: 100%;
      height: 100%;
    }
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-family: var(--vscode-font-family);
      font-size: 14px;
      gap: 16px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--vscode-progressBar-background);
      border-top-color: var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .error {
      padding: 30px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      max-width: 500px;
      margin: 0 auto;
      text-align: center;
    }
    .error h3 {
      color: var(--vscode-errorForeground);
      margin-top: 0;
      margin-bottom: 12px;
      font-size: 16px;
    }
    .error ul {
      text-align: left;
      margin: 16px auto;
      max-width: 300px;
      line-height: 1.6;
    }
    .error button {
      margin-top: 16px;
      padding: 8px 20px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      transition: background 0.2s;
    }
    .error button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div id="chat-container">
    <div class="loading">Initializing Timely Chat...</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const config = ${JSON.stringify({
      token: this._token,
      serviceName: this._config.serviceName,
      avatarIcon: this._config.avatarIcon,
      chatbotIcon: this._config.chatbotIcon,
      faq: this._config.faq,
      instructions: this._config.instructions,
    })};

    let chat;

    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      if (!chat) {
        console.warn('Chat not initialized yet');
        return;
      }

      switch (message.type) {
        case 'toggle-chatbot':
          chat.send('module-toggle', { type: 'open' });
          break;
        case 'open-chat':
          chat.send('chat-open', {
            chat: message.groups,
            instructions: message.instructions,
          });
          break;
        case 'close-chat':
          chat.send('chat-close');
          break;
        case 'send-message':
          // Format code if provided
          let formattedMessage = message.message;
          if (message.code) {
            formattedMessage += '\\n\\n\`\`\`' + message.code.language + '\\n';
            formattedMessage += message.code.content;
            formattedMessage += '\\n\`\`\`';
          }
          // Send message to chat (implementation depends on TimelyChat API)
          // This is a placeholder - adjust based on actual API
          if (chat.sendMessage) {
            chat.sendMessage(formattedMessage);
          }
          break;
      }
    });

    // Load TimelyChat SDK
    function loadScript(url) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    async function initializeChat() {
      const container = document.getElementById('chat-container');
      let retryCount = 0;
      const MAX_RETRIES = 3;

      async function attemptInit() {
        try {
          container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading Timely Chat SDK...</div></div>';

          await loadScript('${CDN_URL}');

          if (!window.TimelyChat) {
            throw new Error('TimelyChat SDK not loaded properly');
          }

          container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Initializing chat interface...</div></div>';

          chat = new window.TimelyChat(
            container,
            {
              token: config.token,
              name: config.serviceName,
              icons: {
                avatar: config.avatarIcon,
                chatbot: config.chatbotIcon,
              },
              chatbot: {
                faq: config.faq,
                instructions: config.instructions,
              },
            },
            {
              style: {
                width: '100%',
                height: '100%',
              },
            }
          );

          console.log('Timely Chat initialized successfully');
        } catch (error) {
          console.error('Chat initialization error:', error);

          if (retryCount < MAX_RETRIES) {
            retryCount++;
            container.innerHTML = \`<div class="loading">
              <div class="spinner"></div>
              <div>Connection failed. Retrying (\${retryCount}/\${MAX_RETRIES})...</div>
            </div>\`;

            await new Promise(resolve => setTimeout(resolve, 2000));
            return attemptInit();
          }

          // Final error state
          const errorMessage = error.message || 'Unknown error';
          vscode.postMessage({
            type: 'error',
            message: 'Failed to initialize Timely Chat: ' + errorMessage
          });

          container.innerHTML = \`
            <div class="error">
              <h3>Failed to load Timely Chat</h3>
              <p>\${errorMessage}</p>
              <p>Please check:</p>
              <ul>
                <li>Your internet connection</li>
                <li>API credentials in settings</li>
                <li>Firewall/proxy settings</li>
              </ul>
              <button onclick="location.reload()" style="
                margin-top: 10px;
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                cursor: pointer;
                border-radius: 2px;
              ">Retry</button>
            </div>
          \`;
        }
      }

      await attemptInit();
    }

    initializeChat();
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
