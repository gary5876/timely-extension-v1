import * as vscode from 'vscode';
import { ExtensionConfig } from '../types';

/**
 * VSCode 설정에서 확장 설정을 가져옴
 */
export function getExtensionConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('timelyChat');

  return {
    apiKey: config.get<string>('apiKey', ''),
    model: config.get<string>('model', 'gpt-4.1'),
    instructions: config.get<string>('instructions', ''),
  };
}

/**
 * API Key가 설정되어 있는지 확인
 */
export function hasApiKey(): boolean {
  const config = getExtensionConfig();
  return config.apiKey.trim().length > 0;
}

/**
 * API Key 입력 프롬프트 표시
 */
export async function promptForApiKey(): Promise<string | undefined> {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Timely GPT API Key를 입력하세요',
    placeHolder: 'sdk_live_xxxxxxxxxx',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API Key를 입력해주세요';
      }
      return null;
    },
  });

  if (apiKey) {
    // 설정에 저장
    const config = vscode.workspace.getConfiguration('timelyChat');
    await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
    return apiKey;
  }

  return undefined;
}

/**
 * API Key가 없으면 입력받고, 있으면 반환
 */
export async function ensureApiKey(): Promise<string | undefined> {
  const config = getExtensionConfig();

  if (config.apiKey.trim().length > 0) {
    return config.apiKey;
  }

  return promptForApiKey();
}
