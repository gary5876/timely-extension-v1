import * as vscode from 'vscode';
import { getExtensionConfig } from '../utils/config';
import { CDN_URL } from '../types';

/**
 * Provides the webview for the sidebar panel
 */
export class TimelyViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'timely-chat.sidebarView';

  private _view?: vscode.WebviewView;
  private _token?: string;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case 'error':
          vscode.window.showErrorMessage(data.message);
          break;
        case 'info':
          vscode.window.showInformationMessage(data.message);
          break;
        case 'ready':
          // Webview is ready, send token if we have one
          if (this._token) {
            this._view?.webview.postMessage({ type: 'token', token: this._token });
          }
          break;
        case 'configure':
          vscode.commands.executeCommand('workbench.action.openSettings', 'timelyChat');
          break;
      }
    });
  }

  public setToken(token: string) {
    this._token = token;
    if (this._view) {
      this._view.webview.postMessage({ type: 'token', token });
    }
  }

  public async refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const config = getExtensionConfig();

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
      width: 100%;
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
      font-size: 13px;
      gap: 12px;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--vscode-progressBar-background);
      border-top-color: var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .error {
      padding: 20px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      text-align: center;
    }
    .error h3 {
      color: var(--vscode-errorForeground);
      margin-top: 0;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .error button {
      margin-top: 12px;
      padding: 6px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      transition: background 0.2s;
    }
    .error button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div id="chat-container">
    <div class="loading">Loading Timely Chat...</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Configuration from VSCode settings
    const config = ${JSON.stringify({
      serviceName: config.serviceName,
      avatarIcon: config.avatarIcon,
      chatbotIcon: config.chatbotIcon,
      faq: config.faq,
      instructions: config.instructions,
    })};

    let chat;
    let token;

    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'token':
          token = message.token;
          initializeChat();
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

      if (!token) {
        container.innerHTML = \`
          <div class="error">
            <h3>Authentication Required</h3>
            <p>Please configure your API credentials in settings.</p>
            <button onclick="vscode.postMessage({ type: 'configure' })" style="
              margin-top: 10px;
              padding: 8px 16px;
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none;
              cursor: pointer;
              border-radius: 2px;
            ">Open Settings</button>
          </div>
        \`;
        return;
      }

      let retryCount = 0;
      const MAX_RETRIES = 3;

      async function attemptInit() {
        try {
          container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading Timely Chat...</div></div>';

          await loadScript('${CDN_URL}');

          if (!window.TimelyChat) {
            throw new Error('TimelyChat SDK not loaded properly');
          }

          container.innerHTML = '';

          chat = new window.TimelyChat(
            container,
            {
              token: token,
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

          console.log('Timely Chat loaded successfully');
        } catch (error) {
          console.error('Chat initialization error:', error);

          if (retryCount < MAX_RETRIES) {
            retryCount++;
            container.innerHTML = \`<div class="loading">
              <div class="spinner"></div>
              <div>Retrying (\${retryCount}/\${MAX_RETRIES})...</div>
            </div>\`;

            await new Promise(resolve => setTimeout(resolve, 2000));
            return attemptInit();
          }

          const errorMessage = error.message || 'Unknown error';
          vscode.postMessage({
            type: 'error',
            message: 'Failed to load Timely Chat: ' + errorMessage
          });

          container.innerHTML = \`
            <div class="error">
              <h3>Failed to load chat</h3>
              <p>\${errorMessage}</p>
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

    // Signal that webview is ready
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
