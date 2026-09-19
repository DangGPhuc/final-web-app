/**
 * Gmail Provider — server-side only
 *
 * Reads bank notification emails via Gmail API.
 * OAuth tokens are NEVER exposed to the browser.
 *
 * Requires environment variables:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN
 *   GMAIL_USER_EMAIL
 *
 * Setup:
 * 1. Create OAuth 2.0 credentials in Google Cloud Console
 * 2. Enable Gmail API
 * 3. Authorize with scope: https://www.googleapis.com/auth/gmail.readonly
 * 4. Obtain refresh token via OAuth flow
 * 5. Store credentials in .env.local (NEVER commit)
 */

import type { EmailProvider, EmailMessage } from './provider';

interface GmailTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
}

interface GmailMessageResponse {
  id: string;
  snippet: string;
  internalDate: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    parts?: { mimeType: string; body?: { data?: string } }[];
  };
}

export class GmailProvider implements EmailProvider {
  readonly name = 'gmail';

  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private userEmail: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor() {
    this.clientId = process.env.GMAIL_CLIENT_ID || '';
    this.clientSecret = process.env.GMAIL_CLIENT_SECRET || '';
    this.refreshToken = process.env.GMAIL_REFRESH_TOKEN || '';
    this.userEmail = process.env.GMAIL_USER_EMAIL || '';
  }

  private get isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken && this.userEmail);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to refresh Gmail access token');
    }

    const data: GmailTokenResponse = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  async isConnected(): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<{ connected: boolean; email?: string; error?: string }> {
    if (!this.isConfigured) {
      return { connected: false, error: 'Gmail chưa được cấu hình. Cần thiết lập GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN trong .env.local' };
    }
    try {
      await this.getAccessToken();
      return { connected: true, email: this.userEmail };
    } catch (e) {
      return { connected: false, error: 'Không thể kết nối Gmail. Token có thể đã hết hạn.' };
    }
  }

  async fetchMessages(since?: string): Promise<EmailMessage[]> {
    const token = await this.getAccessToken();

    // Build search query for bank notification emails
    let query = 'category:primary OR label:inbox';
    if (since) {
      const sinceDate = new Date(since);
      const afterStr = `${sinceDate.getFullYear()}/${sinceDate.getMonth() + 1}/${sinceDate.getDate()}`;
      query += ` after:${afterStr}`;
    }

    // List messages
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!listRes.ok) {
      throw new Error(`Gmail API error: ${listRes.status}`);
    }

    const listData: GmailMessageListResponse = await listRes.json();
    if (!listData.messages?.length) return [];

    // Fetch individual messages (limit to prevent abuse)
    const messages: EmailMessage[] = [];
    const batch = listData.messages.slice(0, 50);

    for (const msg of batch) {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
        const msgRes = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!msgRes.ok) continue;

        const msgData: GmailMessageResponse = await msgRes.json();
        const headers = msgData.payload.headers;

        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        const dateStr = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

        messages.push({
          id: msgData.id,
          from,
          subject,
          snippet: msgData.snippet || '',
          receivedAt: dateStr || new Date(parseInt(msgData.internalDate)).toISOString(),
        });
      } catch {
        // Skip individual message errors
        continue;
      }
    }

    return messages;
  }
}
