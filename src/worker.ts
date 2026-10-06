/**
 * Cloudflare Workers Entry Point for Gmail MCP Server
 * Implements MCP protocol with SSE support for ChatGPT integration
 */

import { google } from 'googleapis';
import { gmailTools } from './mcp/tools.js';

// Environment interface for Cloudflare Workers
interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  FRONTEND_URL: string;
  BACKEND_API_URL?: string; // Optional: Backend API URL for token fallback
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;
  NODE_ENV: string;
  SESSIONS: KVNamespace;
}

// Session data structure
interface SessionData {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  createdAt: string;
}

// OAuth token structure
interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

// Gmail Client for Cloudflare Workers
class GmailClientWorker {
  private accessToken: string;
  private env: Env;

  constructor(accessToken: string, env: Env) {
    this.accessToken = accessToken;
    this.env = env;
  }

  private getClient() {
    const oauth2Client = new google.auth.OAuth2(
      this.env.GOOGLE_CLIENT_ID,
      this.env.GOOGLE_CLIENT_SECRET,
      this.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: this.accessToken,
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  private parseMessage(message: any) {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let body = '';
    const attachments: any[] = [];

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
        body = decoded.replace(/<[^>]*>/g, '');
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

  async listMessages(options: {
    query?: string;
    maxResults?: number;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  } = {}) {
    const gmail = this.getClient();
    const {
      query = '',
      maxResults = 20,
      labelIds = [],
      includeSpamTrash = false,
    } = options;

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
      return [];
    }

    const messagesToFetch = messageIds.slice(0, Math.min(maxResults, 20));
    const messagePromises = messagesToFetch.map((msg) =>
      gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      })
    );

    const messageResponses = await Promise.all(messagePromises);
    return messageResponses.map((response) => this.parseMessage(response.data));
  }

  async sendEmail(emailData: {
    to: string | string[];
    subject: string;
    body: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    inReplyTo?: string;
  }): Promise<string> {
    const gmail = this.getClient();

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

    return response.data.id!;
  }

  async createDraft(draftData: {
    to?: string | string[];
    subject?: string;
    body?: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
  }): Promise<string> {
    const gmail = this.getClient();

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

    return response.data.id!;
  }

  async getLabels(): Promise<any[]> {
    const gmail = this.getClient();
    const response = await gmail.users.labels.list({
      userId: 'me',
    });
    return response.data.labels || [];
  }

  async getProfile(): Promise<any> {
    const gmail = this.getClient();
    const response = await gmail.users.getProfile({
      userId: 'me',
    });
    return response.data;
  }

  async listMessageIds(options: {
    query?: string;
    maxResults?: number;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  } = {}): Promise<string[]> {
    const gmail = this.getClient();
    const {
      query = '',
      maxResults = 20,
      labelIds = [],
      includeSpamTrash = false,
    } = options;

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
    return (listResponse.data.messages || []).map((msg) => msg.id!);
  }

  async getMessage(messageId: string): Promise<any> {
    const gmail = this.getClient();
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    return this.parseMessage(response.data);
  }

  async getMessages(messageIds: string[]): Promise<any[]> {
    const gmail = this.getClient();
    const messagePromises = messageIds.map((id) =>
      gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      })
    );
    const messageResponses = await Promise.all(messagePromises);
    return messageResponses.map((response) => this.parseMessage(response.data));
  }
}

/**
 * OAuth Manager for Cloudflare Workers
 */
class CloudflareOAuthManager {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private getOAuth2Client() {
    return new google.auth.OAuth2(
      this.env.GOOGLE_CLIENT_ID,
      this.env.GOOGLE_CLIENT_SECRET,
      this.env.GOOGLE_REDIRECT_URI
    );
  }

  getAuthorizationUrl(state: string): string {
    const oauth2Client = this.getOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
      ],
      state,
      prompt: 'consent',
    });
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const oauth2Client = this.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    return {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token || undefined,
      expires_in: tokens.expiry_date
        ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
        : 3600,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || undefined,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    return {
      access_token: credentials.access_token!,
      refresh_token: refreshToken,
      expires_in: credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : 3600,
      token_type: credentials.token_type || 'Bearer',
      scope: credentials.scope || undefined,
    };
  }

  async storeSession(userId: string, tokens: OAuthTokens): Promise<void> {
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : undefined;

    const sessionData: SessionData = {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    await this.env.SESSIONS.put(
      `session:${userId}`,
      JSON.stringify(sessionData),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
  }

  async getSession(userId: string): Promise<SessionData | null> {
    const data = await this.env.SESSIONS.get(`session:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  async isSessionValid(userId: string): Promise<boolean> {
    const session = await this.getSession(userId);
    if (!session) return false;
    if (!session.expiresAt) return true;
    return new Date(session.expiresAt) > new Date();
  }

  async getValidAccessToken(userId: string): Promise<string | null> {
    // First, try to get from KV store (fast path)
    const session = await this.getSession(userId);
    if (session && await this.isSessionValid(userId)) {
      return session.accessToken;
    }

    // If session exists but expired, try to refresh
    if (session && session.refreshToken) {
      try {
        const newTokens = await this.refreshAccessToken(session.refreshToken);
        await this.storeSession(userId, newTokens);
        return newTokens.access_token;
      } catch (error) {
        console.error('Failed to refresh token from KV:', error);
        // Fall through to backend API fallback
      }
    }

    // Fallback: Query backend API for tokens from profile.settings.oauth_tokens
    // This ensures we can still work even if KV sync failed
    // Note: This requires BACKEND_API_URL to be set in environment variables
    try {
      const backendUrl = this.env.BACKEND_API_URL || 
                        (this.env.FRONTEND_URL ? this.env.FRONTEND_URL.replace(/\/$/, '') : null) ||
                        'https://api.zerotwo.app';
      
      const response = await fetch(`${backendUrl}/api/ai/tools/gmail/token?userId=${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = (await response.json()) as {
          accessToken?: string;
          refreshToken?: string;
          expiresIn?: number;
        };
        if (data.accessToken) {
          // Store in KV for future use
          await this.storeSession(userId, {
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
            expires_in: data.expiresIn,
            token_type: 'Bearer',
          });
          return data.accessToken;
        }
      }
    } catch (error) {
      console.error('Failed to fetch token from backend API (fallback):', error);
      // This is a fallback, so we don't throw - just return null
    }

    return null;
  }

  async removeSession(userId: string): Promise<void> {
    await this.env.SESSIONS.delete(`session:${userId}`);
  }
}

/**
 * CORS headers
 */
function getCorsHeaders(origin?: string): Record<string, string> {
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://zerotwo.app',
  ];

  const requestOrigin = origin || '';
  const allowOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Authorization',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Handle OPTIONS requests
 */
function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get('Origin') || undefined),
  });
}

/**
 * Execute MCP tool
 */
async function executeTool(
  toolName: string,
  args: any,
  oauthManager: CloudflareOAuthManager,
  env: Env,
  requestHeaders?: Headers
): Promise<any> {
  // Get userId from args or from X-User-Id header
  let userId = args?.userId;
  if (!userId && requestHeaders) {
    userId = requestHeaders.get('X-User-Id');
  }
  
  if (!userId) {
    return {
      content: [
        {
          type: 'text',
          text: 'User ID is required for all Gmail operations. Please provide userId in tool arguments or X-User-Id header.',
        },
      ],
      isError: true,
    };
  }

  // First, try to get access token from X-Access-Token header (passed directly from backend)
  let accessToken = requestHeaders?.get('X-Access-Token') || null;
  
  // If not in header, fall back to KV storage lookup
  if (!accessToken) {
    accessToken = await oauthManager.getValidAccessToken(userId);
  }
  
  if (!accessToken) {
    return {
      content: [
        {
          type: 'text',
          text: 'Authentication required. Please authenticate with Gmail first.',
        },
      ],
      isError: true,
    };
  }

  const gmailClient = new GmailClientWorker(accessToken, env);

  try {
    switch (toolName) {
      case 'gmail_get_profile': {
        const profile = await gmailClient.getProfile();
        const output = {
          emailAddress: profile.emailAddress,
          messagesTotal: profile.messagesTotal,
          threadsTotal: profile.threadsTotal,
          historyId: profile.historyId,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'gmail_search_emails': {
        const { query, maxResults, labelIds, includeSpamTrash } = args;
        const messages = await gmailClient.listMessages({
          query,
          maxResults,
          labelIds,
          includeSpamTrash,
        });

        const output = {
          messages: messages.map((msg) => ({
            id: msg.id,
            threadId: msg.threadId,
            subject: msg.subject,
            from: msg.from,
            to: msg.to,
            date: msg.date,
            snippet: msg.snippet,
            body: msg.body,
          })),
          count: messages.length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'gmail_search_email_ids': {
        const { query, maxResults, labelIds, includeSpamTrash } = args;
        const messageIds = await gmailClient.listMessageIds({
          query,
          maxResults,
          labelIds,
          includeSpamTrash,
        });

        const output = {
          messageIds,
          count: messageIds.length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'gmail_get_recent_emails': {
        const { maxResults, includeSpamTrash } = args;
        const messages = await gmailClient.listMessages({
          maxResults,
          includeSpamTrash,
        });

        const output = {
          messages: messages.map((msg) => ({
            id: msg.id,
            threadId: msg.threadId,
            subject: msg.subject,
            from: msg.from,
            to: msg.to,
            date: msg.date,
            snippet: msg.snippet,
            body: msg.body,
          })),
          count: messages.length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'gmail_read_email': {
        const { messageId } = args;
        const message = await gmailClient.getMessage(messageId);

        const output = {
          id: message.id,
          threadId: message.threadId,
          subject: message.subject,
          from: message.from,
          to: message.to,
          cc: message.cc,
          date: message.date,
          snippet: message.snippet,
          body: message.body,
          labelIds: message.labelIds,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'gmail_batch_read_email': {
        const { messageIds } = args;
        const messages = await gmailClient.getMessages(messageIds);

        const output = {
          messages: messages.map((msg) => ({
            id: msg.id,
            threadId: msg.threadId,
            subject: msg.subject,
            from: msg.from,
            to: msg.to,
            cc: msg.cc,
            date: msg.date,
            snippet: msg.snippet,
            body: msg.body,
            labelIds: msg.labelIds,
          })),
          count: messages.length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${toolName}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error: any) {
    console.error(`Error executing tool ${toolName}:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle MCP protocol requests
 */
async function handleMcpRequest(
  request: Request,
  env: Env,
  oauthManager: CloudflareOAuthManager
): Promise<Response> {
  const requestHeaders = request.headers;
  try {
    const body = (await request.json()) as {
      method?: string;
      id?: string | number;
      params?: {
        name?: string;
        arguments?: any;
      };
    };

    // Handle initialize request
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: env.MCP_SERVER_NAME || 'gmail-mcp-server',
              version: env.MCP_SERVER_VERSION || '1.0.0',
            },
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    // Handle tools/list request
    if (body.method === 'tools/list') {
      const tools = gmailTools.map((tool) => {
        // Extract schema properties from Zod schema
        const schema = tool.definition.inputSchema as any;
        const properties: Record<string, any> = {};
        const required: string[] = [];
        
        if (schema && typeof schema === 'object') {
          // Check if it's a z.object() with .shape property
          if (schema.shape) {
            Object.entries(schema.shape).forEach(([key, value]: [string, any]) => {
              const zodType = value._def?.typeName;
              let jsonType = 'string';
              
              if (zodType === 'ZodString') {
                jsonType = 'string';
              } else if (zodType === 'ZodNumber') {
                jsonType = 'number';
              } else if (zodType === 'ZodBoolean') {
                jsonType = 'boolean';
              } else if (zodType === 'ZodArray') {
                jsonType = 'array';
                // Try to get array item type
                const itemType = value._def?.type?._def?.typeName;
                if (itemType === 'ZodString') {
                  properties[key] = {
                    type: 'array',
                    items: { type: 'string' },
                    description: value.description || value._def?.description || '',
                  };
                  return;
                }
              }
              
              properties[key] = {
                type: jsonType,
                description: value.description || value._def?.description || '',
              };
              
              // Check if field is required (not optional)
              if (zodType !== 'ZodOptional' && zodType !== 'ZodDefault') {
                required.push(key);
              }
            });
          } else {
            // It's a plain object with Zod schemas as values
            Object.entries(schema).forEach(([key, value]: [string, any]) => {
              if (!value || typeof value !== 'object') return;
              
              // Unwrap optional/default wrappers to get the actual type
              let actualSchema = value;
              let isOptional = false;
              
              if (value._def?.typeName === 'ZodOptional') {
                actualSchema = value._def.innerType;
                isOptional = true;
              } else if (value._def?.typeName === 'ZodDefault') {
                actualSchema = value._def.innerType;
                isOptional = true; // Default values make it optional
              }
              
              const zodType = actualSchema?._def?.typeName;
              let jsonType = 'string';
              let items: any = undefined;
              
              if (zodType === 'ZodString') {
                jsonType = 'string';
              } else if (zodType === 'ZodNumber') {
                jsonType = 'number';
              } else if (zodType === 'ZodBoolean') {
                jsonType = 'boolean';
              } else if (zodType === 'ZodArray') {
                jsonType = 'array';
                // Try to get array item type
                const itemType = actualSchema._def?.type?._def?.typeName;
                if (itemType === 'ZodString') {
                  items = { type: 'string' };
                } else {
                  items = { type: 'string' }; // Default to string array
                }
              }
              
              const property: any = {
                type: jsonType,
                description: actualSchema?.description || actualSchema?._def?.description || value?.description || '',
              };
              
              if (items) {
                property.items = items;
              }
              
              properties[key] = property;
              
              // Check if field is required (not optional)
              if (!isOptional && zodType !== 'ZodOptional' && zodType !== 'ZodDefault') {
                required.push(key);
              }
            });
          }
        }

        return {
          name: tool.name,
          description: tool.definition.description || tool.definition.title || '',
          inputSchema: {
            type: 'object',
            properties,
            required,
          },
        };
      });

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    // Handle tools/call request
    if (body.method === 'tools/call') {
      if (!body.params) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32602,
              message: 'Invalid params',
            },
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(),
            },
          }
        );
      }

      const { name, arguments: args } = body.params;
      if (!name) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32602,
              message: 'Tool name is required',
            },
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(),
            },
          }
        );
      }

      const result = await executeTool(name, args || {}, oauthManager, env, request.headers);

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: result.content,
            isError: result.isError || false,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    // Handle resources/list - return empty list (MCP spec: servers without resources return [])
    if (body.method === 'resources/list') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { resources: [] },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    // Handle prompts/list - return empty list (MCP spec: servers without prompts return [])
    if (body.method === 'prompts/list') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { prompts: [] },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    // Handle notifications (no id field, no response expected)
    // Notifications like notifications/initialized don't have an id and don't require a JSON-RPC response
    // Use 204 No Content for proper HTTP semantics
    if (body.method?.startsWith('notifications/') || (!body.id && body.method)) {
      // For notifications, just acknowledge with 204 No Content
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request.headers.get('Origin') || undefined),
      });
    }

    // Unknown method (only for requests with id)
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request.headers.get('Origin') || undefined),
        },
      }
    );
  } catch (error: any) {
    console.error('MCP request error:', error);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message,
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request.headers.get('Origin') || undefined),
        },
      }
    );
  }
}

/**
 * SSE endpoint for MCP protocol
 */
function createSseResponse(env: Env): Response {
  const encoder = new TextEncoder();
  let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const initMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initMessage)}\n\n`));

      // Keep connection alive
      keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch (e) {
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
          }
        }
      }, 30000);
    },
    cancel() {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...getCorsHeaders(),
    },
  });
}

/**
 * Main Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin || undefined);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    try {
      const oauthManager = new CloudflareOAuthManager(env);

      // Health check
      if (url.pathname === '/health' || url.pathname === '/') {
        return new Response(
          JSON.stringify({
            status: 'healthy',
            server: env.MCP_SERVER_NAME,
            version: env.MCP_SERVER_VERSION,
            timestamp: new Date().toISOString(),
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // OAuth authorization endpoint
      if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
        const userId = url.searchParams.get('userId');
        const state = url.searchParams.get('state');

        if (!userId || !state) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: userId and state' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        const authUrl = oauthManager.getAuthorizationUrl(state);

        return new Response(
          JSON.stringify({ authorizationUrl: authUrl, state }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      // OAuth callback endpoint
      if (url.pathname === '/oauth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          return Response.redirect(
            `${env.FRONTEND_URL}/settings?oauth_error=${encodeURIComponent(error)}`,
            302
          );
        }

        if (!code || !state) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: code and state' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        const tokens = await oauthManager.exchangeCodeForTokens(code);
        const userId = state;

        await oauthManager.storeSession(userId, tokens);

        return Response.redirect(
          `${env.FRONTEND_URL}/settings?oauth_success=true&provider=gmail`,
          302
        );
      }

      // OAuth refresh endpoint
      if (url.pathname === '/oauth/refresh' && request.method === 'POST') {
        const body = (await request.json()) as { userId?: string; refreshToken?: string };
        const { userId, refreshToken } = body;

        if (!userId || !refreshToken) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: userId and refreshToken' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        const tokens = await oauthManager.refreshAccessToken(refreshToken);
        await oauthManager.storeSession(userId, tokens);

        return new Response(
          JSON.stringify({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
            timestamp: new Date().toISOString(),
          }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      // OAuth disconnect endpoint
      if (url.pathname === '/oauth/disconnect' && request.method === 'POST') {
        const body = (await request.json()) as { userId?: string };
        const { userId } = body;

        if (!userId) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameter: userId' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        await oauthManager.removeSession(userId);

        return new Response(
          JSON.stringify({ success: true, message: 'Successfully disconnected' }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      // OAuth token sync endpoint (called by backend after OAuth completes)
      if (url.pathname === '/oauth/sync' && request.method === 'POST') {
        const body = (await request.json()) as {
          userId?: string;
          accessToken?: string;
          refreshToken?: string;
          expiresIn?: number;
        };
        const { userId, accessToken, refreshToken, expiresIn } = body;

        if (!userId || !accessToken) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: userId and accessToken' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        await oauthManager.storeSession(userId, {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
          token_type: 'Bearer',
        });

        return new Response(
          JSON.stringify({ success: true, message: 'Tokens synced successfully' }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      // MCP endpoint - POST for JSON-RPC (StreamableHTTP)
      if (url.pathname === '/mcp' && request.method === 'POST') {
        return handleMcpRequest(request, env, oauthManager);
      }

      // MCP endpoint - GET for SSE (fallback transport)
      // The MCP SDK tries StreamableHTTP first, then falls back to SSE on the same endpoint
      if (url.pathname === '/mcp' && request.method === 'GET') {
        return createSseResponse(env);
      }

      // Legacy SSE endpoint for backward compatibility
      if (url.pathname === '/sse' && request.method === 'GET') {
        return createSseResponse(env);
      }

      // 404 - Not Found
      return new Response(
        JSON.stringify({ error: 'Not Found', message: 'The requested endpoint does not exist' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    } catch (error: any) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error.message,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  },
};
