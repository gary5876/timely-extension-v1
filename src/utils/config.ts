import * as vscode from 'vscode';
import { ExtensionConfig } from '../types';

/**
 * Retrieves extension configuration from VSCode settings
 */
export function getExtensionConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('timelyChat');

  return {
    apiKey: config.get<string>('apiKey', ''),
    spaceRefId: config.get<string>('spaceRefId', ''),
    userName: config.get<string>('userName', ''),
    providerId: config.get<string>('providerId', ''),
    environment: config.get<'production' | 'staging'>('environment', 'production'),
    serviceName: config.get<string>('serviceName', 'Timely Chat'),
    avatarIcon: config.get<string>('avatarIcon', ''),
    chatbotIcon: config.get<string>('chatbotIcon', ''),
    faq: config.get<string[]>('faq', []),
    instructions: config.get<string>('instructions', ''),
  };
}

/**
 * Validates that all required configuration fields are set
 */
export function validateConfig(config: ExtensionConfig): { valid: boolean; missing: string[] } {
  const required = ['apiKey', 'spaceRefId', 'userName', 'providerId'];
  const missing: string[] = [];

  for (const field of required) {
    if (!config[field as keyof ExtensionConfig]) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Prompts user to configure missing settings
 */
export async function promptConfiguration(missing: string[]): Promise<boolean> {
  const action = await vscode.window.showErrorMessage(
    `Timely Chat: Missing required settings: ${missing.join(', ')}`,
    'Open Settings'
  );

  if (action === 'Open Settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'timelyChat');
    return true;
  }

  return false;
}
