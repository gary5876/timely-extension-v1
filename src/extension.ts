import * as vscode from 'vscode';
import { TimelyViewProvider } from './providers/TimelyViewProvider';
import { TimelyChatPanel } from './providers/TimelyChatPanel';
import { getExtensionConfig, validateConfig, promptConfiguration } from './utils/config';
import { getToken } from './utils/auth';
import * as history from './utils/history';

let sidebarProvider: TimelyViewProvider | undefined;
let currentToken: string | undefined;
let tokenTimestamp: number | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Timely Chat extension is now active');

  // Initialize status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'timely-chat.openChat';
  statusBarItem.text = '$(comment-discussion) Timely Chat';
  statusBarItem.tooltip = 'Open Timely Chat (Ctrl+Alt+C)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Initialize sidebar provider
  sidebarProvider = new TimelyViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TimelyViewProvider.viewType,
      sidebarProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.openChat', async () => {
      await openChatInEditor(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.closeChat', () => {
      TimelyChatPanel.kill();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.toggleChatbot', async () => {
      const panel = TimelyChatPanel.currentPanel;
      if (panel) {
        panel.toggleChatbot();
      } else {
        vscode.window.showInformationMessage('Please open a chat first');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.configure', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'timelyChat');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.sendSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected');
        return;
      }

      const selectedText = editor.document.getText(selection);
      const languageId = editor.document.languageId;
      const fileName = editor.document.fileName;

      // Open chat if not already open
      const config = getExtensionConfig();
      const validation = validateConfig(config);

      if (!validation.valid) {
        await promptConfiguration(validation.missing);
        return;
      }

      try {
        const token = await ensureAuthenticated(context);

        // Create or show panel
        TimelyChatPanel.createOrShow(context.extensionUri, token, config);

        // Send the selected code
        if (TimelyChatPanel.currentPanel) {
          const message = `I have a question about this code from ${fileName}:`;
          TimelyChatPanel.currentPanel.sendMessage(message, {
            language: languageId,
            content: selectedText,
            fileName: fileName,
          });
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to send selection: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.showHistory', async () => {
      const sessions = await history.getChatSessions(context);

      if (sessions.length === 0) {
        vscode.window.showInformationMessage('No chat history available');
        return;
      }

      // Create quick pick items
      const items = sessions.map(session => ({
        label: session.title,
        description: new Date(session.updatedAt).toLocaleString(),
        detail: `${session.messages.length} messages`,
        session,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a chat session to view',
      });

      if (selected) {
        // Create a new document to display the history
        const content = formatSessionForDisplay(selected.session);
        const doc = await vscode.workspace.openTextDocument({
          content,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.clearHistory', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Are you sure you want to clear all chat history? This cannot be undone.',
        'Clear History',
        'Cancel'
      );

      if (answer === 'Clear History') {
        await history.clearAllHistory(context);
        vscode.window.showInformationMessage('Chat history cleared');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('timely-chat.exportHistory', async () => {
      const exportData = await history.exportHistory(context);

      if (!exportData || exportData === '[]') {
        vscode.window.showInformationMessage('No chat history to export');
        return;
      }

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('timely-chat-history.json'),
        filters: {
          'JSON Files': ['json'],
        },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(exportData, 'utf-8'));
        vscode.window.showInformationMessage(`Chat history exported to ${uri.fsPath}`);
      }
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('timelyChat')) {
        // Clear token when config changes
        currentToken = undefined;
        tokenTimestamp = undefined;

        // Refresh webviews
        if (sidebarProvider) {
          await sidebarProvider.refresh();
        }
        if (TimelyChatPanel.currentPanel) {
          TimelyChatPanel.currentPanel.refresh();
        }
      }
    })
  );

  // Auto-authenticate on startup if config is valid
  const config = getExtensionConfig();
  const validation = validateConfig(config);

  if (validation.valid) {
    try {
      await ensureAuthenticated(context);
    } catch (error) {
      console.error('Failed to authenticate on startup:', error);
      updateStatusBar('error');
    }
  } else {
    updateStatusBar('disconnected');
  }
}

async function openChatInEditor(context: vscode.ExtensionContext) {
  const config = getExtensionConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    await promptConfiguration(validation.missing);
    return;
  }

  try {
    const token = await ensureAuthenticated(context);
    TimelyChatPanel.createOrShow(context.extensionUri, token, config);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open chat: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

async function ensureAuthenticated(context: vscode.ExtensionContext): Promise<string> {
  // Check if we have a valid token
  if (currentToken && tokenTimestamp) {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (now - tokenTimestamp < TWENTY_FOUR_HOURS) {
      updateStatusBar('authenticated');
      return currentToken;
    }
  }

  // Need to get a new token
  const config = getExtensionConfig();

  try {
    updateStatusBar('authenticating');

    const token = await getToken(
      {
        apiKey: config.apiKey,
        spaceRefId: config.spaceRefId,
        name: config.userName,
        providerId: config.providerId,
      },
      config.environment
    );

    currentToken = token;
    tokenTimestamp = Date.now();

    // Update sidebar with new token
    if (sidebarProvider) {
      sidebarProvider.setToken(token);
    }

    updateStatusBar('authenticated');
    return token;
  } catch (error) {
    updateStatusBar('error');
    throw new Error(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function updateStatusBar(status: 'authenticated' | 'authenticating' | 'error' | 'disconnected') {
  if (!statusBarItem) {
    return;
  }

  switch (status) {
    case 'authenticated':
      statusBarItem.text = '$(comment-discussion) Timely Chat';
      statusBarItem.tooltip = 'Open Timely Chat (Ctrl+Alt+C)';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'authenticating':
      statusBarItem.text = '$(sync~spin) Timely Chat';
      statusBarItem.tooltip = 'Authenticating...';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = '$(alert) Timely Chat';
      statusBarItem.tooltip = 'Authentication failed. Click to configure.';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      statusBarItem.command = 'timely-chat.configure';
      break;
    case 'disconnected':
      statusBarItem.text = '$(circle-slash) Timely Chat';
      statusBarItem.tooltip = 'Not configured. Click to configure.';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.command = 'timely-chat.configure';
      break;
  }
}

function formatSessionForDisplay(session: history.ChatSession): string {
  let content = `# ${session.title}\n\n`;
  content += `**Created:** ${new Date(session.createdAt).toLocaleString()}\n`;
  content += `**Last Updated:** ${new Date(session.updatedAt).toLocaleString()}\n`;
  content += `**Messages:** ${session.messages.length}\n\n`;
  content += '---\n\n';

  for (const message of session.messages) {
    const time = new Date(message.timestamp).toLocaleTimeString();
    const role = message.role === 'user' ? '👤 You' : '🤖 Assistant';

    content += `### ${role} (${time})\n\n`;

    if (message.metadata?.fileName) {
      content += `*From: ${message.metadata.fileName}*\n\n`;
    }

    if (message.metadata?.language && message.content.includes('```')) {
      content += message.content + '\n\n';
    } else {
      content += message.content + '\n\n';
    }

    content += '---\n\n';
  }

  return content;
}

export function deactivate() {
  TimelyChatPanel.kill();
}
