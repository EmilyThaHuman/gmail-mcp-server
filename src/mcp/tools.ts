/**
 * MCP Tool definitions for Gmail operations
 */

import { z } from 'zod';
import { gmailClient } from '../gmail/client.js';
import { oauthManager } from '../auth/oauth-manager.js';
import { logger } from '../utils/logger.js';

/**
 * Get Profile Tool
 */
export const getProfileTool = {
  name: 'gmail_get_profile',
  definition: {
    title: 'Get Gmail Profile',
    description: "Use this when you need mailbox-level account context for the authenticated Gmail user, such as the email address and message/thread counts. It does not return individual emails.",
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
    },
    outputSchema: {
      emailAddress: z.string(),
      messagesTotal: z.number(),
      threadsTotal: z.number(),
      historyId: z.string(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId } = args;

      logger.info('[Tool:gmail_get_profile] Executing', { userId });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Get profile
      const profile = await gmailClient.getProfile(accessToken);

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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:gmail_get_profile] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error getting profile: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Search Emails Tool
 */
export const searchEmailsTool = {
  name: 'gmail_search_emails',
  definition: {
    title: 'Search Gmail Emails',
    description: 'Use this when you want Gmail search results with the actual message bodies included in the response. Prefer this over `gmail_search_email_ids` when the task is to immediately read or summarize a small set of matching emails.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      query: z.string().optional().describe('Search query (Gmail search syntax)'),
      maxResults: z.number().min(1).max(100).default(20).describe('Maximum number of messages to return'),
      labelIds: z.array(z.string()).optional().describe('Filter by label IDs'),
      includeSpamTrash: z.boolean().default(false).describe('Include spam and trash'),
    },
    outputSchema: {
      messages: z.array(
        z.object({
          id: z.string(),
          threadId: z.string(),
          subject: z.string(),
          from: z.string(),
          to: z.array(z.string()),
          date: z.string(),
          snippet: z.string(),
          body: z.string(),
        })
      ),
      count: z.number(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, query, maxResults, labelIds, includeSpamTrash } = args;

      logger.info('[Tool:gmail_search_emails] Executing', { userId, query, maxResults });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch messages
      const messages = await gmailClient.listMessages(accessToken, {
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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:gmail_search_emails] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error searching emails: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Search Email IDs Tool
 */
export const searchEmailIdsTool = {
  name: 'gmail_search_email_ids',
  definition: {
    title: 'Search Gmail Email IDs',
    description: 'Use this when you only need Gmail message IDs for a follow-up read step. Prefer it over `gmail_search_emails` when you plan to inspect specific messages with `gmail_read_email` or `gmail_batch_read_email`.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      query: z.string().optional().describe('Search query (Gmail search syntax)'),
      maxResults: z.number().min(1).max(100).default(20).describe('Maximum number of message IDs to return'),
      labelIds: z.array(z.string()).optional().describe('Filter by label IDs'),
      includeSpamTrash: z.boolean().default(false).describe('Include spam and trash'),
    },
    outputSchema: {
      messageIds: z.array(z.string()),
      count: z.number(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, query, maxResults, labelIds, includeSpamTrash } = args;

      logger.info('[Tool:gmail_search_email_ids] Executing', { userId, query, maxResults });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch message IDs
      const messageIds = await gmailClient.listMessageIds(accessToken, {
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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:gmail_search_email_ids] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error searching email IDs: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Get Recent Emails Tool
 */
export const getRecentEmailsTool = {
  name: 'gmail_get_recent_emails',
  definition: {
    title: 'Get Recent Gmail Messages',
    description: 'Use this to get the latest received Gmail messages, including snippets and bodies, when there is no search query and the task is simply "show the newest emails."',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      maxResults: z.number().min(1).max(100).default(20).describe('Maximum number of messages to return'),
      includeSpamTrash: z.boolean().default(false).describe('Include spam and trash'),
    },
    outputSchema: {
      messages: z.array(
        z.object({
          id: z.string(),
          threadId: z.string(),
          subject: z.string(),
          from: z.string(),
          to: z.array(z.string()),
          date: z.string(),
          snippet: z.string(),
          body: z.string(),
        })
      ),
      count: z.number(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, maxResults, includeSpamTrash } = args;

      logger.info('[Tool:gmail_get_recent_emails] Executing', { userId, maxResults });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch recent messages (no query = all messages, sorted by most recent)
      const messages = await gmailClient.listMessages(accessToken, {
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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:gmail_get_recent_emails] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error getting recent emails: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Read Email Tool
 */
export const readEmailTool = {
  name: 'gmail_read_email',
  definition: {
    title: 'Read Gmail Message',
    description: 'Use this to read one specific Gmail message when you already have its `messageId` from `gmail_search_emails`, `gmail_search_email_ids`, or `gmail_get_recent_emails`. It returns the full body and detailed message metadata.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      messageId: z.string().describe('Gmail message ID returned by `gmail_search_emails`, `gmail_search_email_ids`, or `gmail_get_recent_emails`.'),
    },
    outputSchema: {
      id: z.string(),
      threadId: z.string(),
      subject: z.string(),
      from: z.string(),
      to: z.array(z.string()),
      cc: z.array(z.string()),
      date: z.string(),
      snippet: z.string(),
      body: z.string(),
      labelIds: z.array(z.string()),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, messageId } = args;

      logger.info('[Tool:gmail_read_email] Executing', { userId, messageId });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch message
      const message = await gmailClient.getMessage(accessToken, messageId);

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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:gmail_read_email] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error reading email: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Batch Read Email Tool
 */
export const batchReadEmailTool = {
  name: 'gmail_batch_read_email',
  definition: {
    title: 'Batch Read Gmail Messages',
    description: 'Use this to read several known Gmail messages in one request after a search or recent-email step. Pass the `messageIds` returned by the Gmail list/search tools when you need the full bodies for multiple emails.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      messageIds: z.array(z.string()).describe('Array of Gmail message IDs returned by `gmail_search_emails`, `gmail_search_email_ids`, or `gmail_get_recent_emails`.'),
    },
    outputSchema: {
      messages: z.array(
        z.object({
          id: z.string(),
          threadId: z.string(),
          subject: z.string(),
          from: z.string(),
          to: z.array(z.string()),
          cc: z.array(z.string()),
          date: z.string(),
          snippet: z.string(),
          body: z.string(),
          labelIds: z.array(z.string()),
        })
      ),
      count: z.number(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, messageIds } = args;

      logger.info('[Tool:gmail_batch_read_email] Executing', { userId, count: messageIds.length });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch messages
      const messages = await gmailClient.getMessages(accessToken, messageIds);

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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:gmail_batch_read_email] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error batch reading emails: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Export all tools
 */
export const gmailTools = [
  getProfileTool,
  searchEmailsTool,
  searchEmailIdsTool,
  getRecentEmailsTool,
  readEmailTool,
  batchReadEmailTool,
];
