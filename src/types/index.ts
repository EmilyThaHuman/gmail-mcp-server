/**
 * Type definitions for Gmail MCP Server
 */

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
  attachments: Attachment[];
  internalDate: string;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

export interface EmailData {
  to: string | string[];
  subject: string;
  body: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  inReplyTo?: string;
}

export interface DraftData {
  to?: string | string[];
  subject?: string;
  body?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface SessionData {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  createdAt: Date;
}






