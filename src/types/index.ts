/**
 * Timely Chat Types
 * Based on the Timely GPT AI Module documentation
 */

export interface TimelyConfig {
  spaceRefId: string;
  providerId: string;
  name: string;
  apiKey: string;
}

export interface TimelyAuthResponse {
  success: boolean;
  data?: string;
  error?: string;
}

export interface ChatGroup {
  refId: string;
  name: string;
}

export interface ChatOpenConfig {
  size?: {
    width: number;
    height: number;
  };
  position?: {
    x: number;
    y: number;
  };
  draggable?: boolean;
  resizable?: boolean;
}

export interface ChatOpenParams {
  chat: ChatGroup[];
  config?: ChatOpenConfig;
  instructions?: string;
}

export interface ModuleToggleParams {
  type: 'open' | 'close';
}

export interface TimelyIcons {
  avatar?: string;
  chatbot?: string;
}

export interface ChatbotConfig {
  faq?: string[];
  instructions?: string;
}

export interface TimelyInitConfig {
  token: string;
  name: string;
  icons: TimelyIcons;
  chatbot?: ChatbotConfig;
}

export interface TimelyStyleConfig {
  style?: Partial<CSSStyleDeclaration>;
}

export type Environment = 'production' | 'staging';

export interface ExtensionConfig {
  apiKey: string;
  spaceRefId: string;
  userName: string;
  providerId: string;
  environment: Environment;
  serviceName: string;
  avatarIcon: string;
  chatbotIcon: string;
  faq: string[];
  instructions: string;
}

export const API_URLS = {
  production: 'https://ai.timelygpt.co.kr/api-back',
  staging: 'https://ai.stg.timelygpt.co.kr/api-back',
} as const;

export const CDN_URL = 'https://cdn.jsdelivr.net/gh/timely-hub/timely-chat@p.1.0.3/index.js';
