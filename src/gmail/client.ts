/**
 * Gmail API Client wrapper
 */

import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { GmailMessage, EmailData, DraftData, Attachment } from '../types/index.js';

export class GmailClient {
  /**
   * Create Gmail API client with access token
   */
  private getClient(accessToken: string) {
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * Parse Gmail message to extract essential fields
   */
  private parseMessage(message: any): GmailMessage {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let body = '';
    const attachments: Attachment[] = [];

    const extractContent = (part: any, isAttachment = false): void => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size,
        });
        return;
      }

      if (part.mimeType === 'text/plain' && part.body?.data && !isAttachment) {
        const decoded = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        body = decoded;
      } else if (part.mimeType === 'text/html' && part.body?.data && !body && !isAttachment) {
        const decoded = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        body = decoded.replace(/<[^>]*>/g, ''); // Strip HTML tags
      }

      if (part.parts) {
        part.parts.forEach((subPart: any) => extractContent(subPart));
      }
    };

    if (message.payload) {
      extractContent(message.payload);
    }

    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
      snippet: message.snippet || '',
      subject: getHeader('subject'),
      from: getHeader('from'),
      to: getHeader('to')
        .split(',')
        .map((addr: string) => addr.trim())
        .filter(Boolean),
      cc: getHeader('cc')
        .split(',')
        .map((addr: string) => addr.trim())
        .filter(Boolean),
      date: getHeader('date'),
      body: body || message.snippet || '',
      attachments,
      internalDate: message.internalDate,
    };
  }

  /**
   * List Gmail messages with optional filtering
   */
  async listMessages(
    accessToken: string,
    options: {
      query?: string;
      maxResults?: number;
      labelIds?: string[];
      includeSpamTrash?: boolean;
    } = {}
  ): Promise<GmailMessage[]> {
    try {
      const gmail = this.getClient(accessToken);

      const {
        query = '',
        maxResults = 20,
        labelIds = [],
        includeSpamTrash = false,
      } = options;

      logger.info('[GmailClient] Listing messages', { query, maxResults, labelIds });

      const requestParams: any = {
        userId: 'me',
        maxResults: Math.min(Math.max(1, maxResults), 100),
        includeSpamTrash,
      };

      if (query) {
        requestParams.q = query;
      }

      if (labelIds && labelIds.length > 0) {
        requestParams.labelIds = labelIds;
      }

      const listResponse = await gmail.users.messages.list(requestParams);
      const messageIds = listResponse.data.messages || [];

      if (messageIds.length === 0) {
        logger.info('[GmailClient] No messages found');
        return [];
      }

      // Fetch full message details
      const messagesToFetch = messageIds.slice(0, Math.min(maxResults, 20));
      const messagePromises = messagesToFetch.map((msg) =>
        gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        })
      );

      const messageResponses = await Promise.all(messagePromises);
      const messages = messageResponses.map((response) => this.parseMessage(response.data));

      logger.info('[GmailClient] Successfully retrieved messages', {
        count: messages.length,
      });

      return messages;
    } catch (error) {
      logger.error('[GmailClient] Error listing messages:', error);
      throw new Error('Failed to list Gmail messages');
    }
  }

  /**
   * Send an email via Gmail
   */
  async sendEmail(accessToken: string, emailData: EmailData): Promise<string> {
    try {
      const gmail = this.getClient(accessToken);

      logger.info('[GmailClient] Sending email', {
        to: emailData.to,
        subject: emailData.subject,
      });

      // Create email message in RFC 2822 format
      const recipients = Array.isArray(emailData.to) ? emailData.to : [emailData.to];
      const ccRecipients = emailData.cc
        ? Array.isArray(emailData.cc)
          ? emailData.cc
          : [emailData.cc]
        : [];
      const bccRecipients = emailData.bcc
        ? Array.isArray(emailData.bcc)
          ? emailData.bcc
          : [emailData.bcc]
        : [];

      let emailContent = '';
      if (emailData.from) {
        emailContent += `From: ${emailData.from}\n`;
      }
      emailContent += `To: ${recipients.join(', ')}\n`;
      if (ccRecipients.length > 0) {
        emailContent += `Cc: ${ccRecipients.join(', ')}\n`;
      }
      if (bccRecipients.length > 0) {
        emailContent += `Bcc: ${bccRecipients.join(', ')}\n`;
      }
      emailContent += `Subject: ${emailData.subject}\n`;
      if (emailData.replyTo) {
        emailContent += `Reply-To: ${emailData.replyTo}\n`;
      }
      if (emailData.inReplyTo) {
        emailContent += `In-Reply-To: ${emailData.inReplyTo}\n`;
      }
      emailContent += `Content-Type: text/plain; charset=utf-8\n\n`;
      emailContent += emailData.body;

      // Encode as base64url
      const encodedEmail = Buffer.from(emailContent)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
        },
      });

      const messageId = response.data.id!;
      logger.info('[GmailClient] Successfully sent email', { messageId });

      return messageId;
    } catch (error) {
      logger.error('[GmailClient] Error sending email:', error);
      throw new Error('Failed to send email');
    }
  }

  /**
   * Create a draft email in Gmail
   */
  async createDraft(accessToken: string, draftData: DraftData): Promise<string> {
    try {
      const gmail = this.getClient(accessToken);

      logger.info('[GmailClient] Creating draft', {
        to: draftData.to || 'empty',
        subject: draftData.subject || 'empty',
      });

      // Create draft email message in RFC 2822 format
      const recipients = draftData.to
        ? Array.isArray(draftData.to)
          ? draftData.to
          : [draftData.to]
        : [];
      const ccRecipients = draftData.cc
        ? Array.isArray(draftData.cc)
          ? draftData.cc
          : [draftData.cc]
        : [];
      const bccRecipients = draftData.bcc
        ? Array.isArray(draftData.bcc)
          ? draftData.bcc
          : [draftData.bcc]
        : [];

      let emailContent = '';
      if (draftData.from) {
        emailContent += `From: ${draftData.from}\n`;
      }
      if (recipients.length > 0) {
        emailContent += `To: ${recipients.join(', ')}\n`;
      }
      if (ccRecipients.length > 0) {
        emailContent += `Cc: ${ccRecipients.join(', ')}\n`;
      }
      if (bccRecipients.length > 0) {
        emailContent += `Bcc: ${bccRecipients.join(', ')}\n`;
      }
      if (draftData.subject) {
        emailContent += `Subject: ${draftData.subject}\n`;
      }
      emailContent += `Content-Type: text/plain; charset=utf-8\n\n`;
      emailContent += draftData.body || '';

      // Encode as base64url
      const encodedEmail = Buffer.from(emailContent)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: encodedEmail,
          },
        },
      });

      const draftId = response.data.id!;
      logger.info('[GmailClient] Successfully created draft', { draftId });

      return draftId;
    } catch (error) {
      logger.error('[GmailClient] Error creating draft:', error);
      throw new Error('Failed to create draft');
    }
  }

  /**
   * Get labels
   */
  async getLabels(accessToken: string): Promise<any[]> {
    try {
      const gmail = this.getClient(accessToken);

      logger.info('[GmailClient] Getting labels');

      const response = await gmail.users.labels.list({
        userId: 'me',
      });

      const labels = response.data.labels || [];
      logger.info('[GmailClient] Successfully retrieved labels', { count: labels.length });

      return labels;
    } catch (error) {
      logger.error('[GmailClient] Error getting labels:', error);
      throw new Error('Failed to get labels');
    }
  }

  /**
   * Get user profile
   */
  async getProfile(accessToken: string): Promise<any> {
    try {
      const gmail = this.getClient(accessToken);

      logger.info('[GmailClient] Getting user profile');

      const response = await gmail.users.getProfile({
        userId: 'me',
      });

      logger.info('[GmailClient] Successfully retrieved profile');

      return response.data;
    } catch (error) {
      logger.error('[GmailClient] Error getting profile:', error);
      throw new Error('Failed to get user profile');
    }
  }

  /**
   * Get message IDs only (without full message details)
   */
  async listMessageIds(
    accessToken: string,
    options: {
      query?: string;
      maxResults?: number;
      labelIds?: string[];
      includeSpamTrash?: boolean;
    } = {}
  ): Promise<string[]> {
    try {
      const gmail = this.getClient(accessToken);

      const {
        query = '',
        maxResults = 20,
        labelIds = [],
        includeSpamTrash = false,
      } = options;

      logger.info('[GmailClient] Listing message IDs', { query, maxResults, labelIds });

      const requestParams: any = {
        userId: 'me',
        maxResults: Math.min(Math.max(1, maxResults), 100),
        includeSpamTrash,
      };

      if (query) {
        requestParams.q = query;
      }

      if (labelIds && labelIds.length > 0) {
        requestParams.labelIds = labelIds;
      }

      const listResponse = await gmail.users.messages.list(requestParams);
      const messageIds = (listResponse.data.messages || []).map((msg) => msg.id!);

      logger.info('[GmailClient] Successfully retrieved message IDs', {
        count: messageIds.length,
      });

      return messageIds;
    } catch (error) {
      logger.error('[GmailClient] Error listing message IDs:', error);
      throw new Error('Failed to list Gmail message IDs');
    }
  }

  /**
   * Get a single message by ID
   */
  async getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
    try {
      const gmail = this.getClient(accessToken);

      logger.info('[GmailClient] Getting message', { messageId });

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = this.parseMessage(response.data);

      logger.info('[GmailClient] Successfully retrieved message');

      return message;
    } catch (error) {
      logger.error('[GmailClient] Error getting message:', error);
      throw new Error('Failed to get Gmail message');
    }
  }

  /**
   * Get multiple messages by IDs
   */
  async getMessages(accessToken: string, messageIds: string[]): Promise<GmailMessage[]> {
    try {
      const gmail = this.getClient(accessToken);

      logger.info('[GmailClient] Getting multiple messages', { count: messageIds.length });

      const messagePromises = messageIds.map((id) =>
        gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        })
      );

      const messageResponses = await Promise.all(messagePromises);
      const messages = messageResponses.map((response) => this.parseMessage(response.data));

      logger.info('[GmailClient] Successfully retrieved messages', {
        count: messages.length,
      });

      return messages;
    } catch (error) {
      logger.error('[GmailClient] Error getting messages:', error);
      throw new Error('Failed to get Gmail messages');
    }
  }
}

// Singleton instance
export const gmailClient = new GmailClient();






