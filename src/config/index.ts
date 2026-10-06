/**
 * Configuration management for Gmail MCP Server
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    name: process.env.MCP_SERVER_NAME || 'gmail-mcp-server',
    version: process.env.MCP_SERVER_VERSION || '1.0.0',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/oauth/callback',
  },
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:5173',
  },
  gmail: {
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
    ],
  },
};

// Validate required configuration
export function validateConfig(): void {
  const required = [
    { key: 'GOOGLE_CLIENT_ID', value: config.google.clientId },
    { key: 'GOOGLE_CLIENT_SECRET', value: config.google.clientSecret },
  ];

  const missing = required.filter((item) => !item.value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map((item) => item.key).join(', ')}`
    );
  }
}






