/**
 * Email Provider Interface
 * Abstracts email reading so different providers (Gmail, Outlook) can be added.
 */

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string;
  receivedAt: string;
  labels?: string[];
}

export interface EmailProvider {
  readonly name: string;

  /**
   * Check if the provider is connected and has valid credentials
   */
  isConnected(): Promise<boolean>;

  /**
   * Fetch unread/recent bank notification emails since a given date
   */
  fetchMessages(since?: string): Promise<EmailMessage[]>;

  /**
   * Get connection status info
   */
  getStatus(): Promise<{ connected: boolean; email?: string; error?: string }>;
}
