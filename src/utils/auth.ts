import { TimelyConfig, TimelyAuthResponse, API_URLS, Environment } from '../types';

/**
 * Authenticates with Timely API and retrieves access token
 * Token is valid for 24 hours
 */
export async function getToken(
  config: TimelyConfig,
  environment: Environment = 'production',
  retryCount: number = 0
): Promise<string> {
  const { apiKey, ...rest } = config;
  const apiUrl = API_URLS[environment];
  const MAX_RETRIES = 2;

  try {
    const response = await fetch(`${apiUrl}/user/auth/login`, {
      method: 'POST',
      body: JSON.stringify(rest),
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    // Handle HTTP errors
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid API key or credentials. Please check your settings.');
      } else if (response.status === 403) {
        throw new Error('Access forbidden. Please verify your space reference ID.');
      } else if (response.status === 404) {
        throw new Error('API endpoint not found. Please check your environment setting.');
      } else if (response.status >= 500) {
        // Server error - retry
        if (retryCount < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          return getToken(config, environment, retryCount + 1);
        }
        throw new Error(`Server error (${response.status}). Please try again later.`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const result = await response.json() as TimelyAuthResponse;

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Authentication failed - no token received');
    }

    return result.data;
  } catch (error) {
    // Network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Network error. Please check your internet connection.');
    }

    // Re-throw our custom errors
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Timely authentication failed: ${String(error)}`);
  }
}

/**
 * Validates if a token is still valid (not expired)
 * Tokens expire after 24 hours
 */
export function isTokenValid(tokenTimestamp: number): boolean {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return now - tokenTimestamp < TWENTY_FOUR_HOURS;
}
