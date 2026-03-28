# Gmail MCP Server

A Model Context Protocol (MCP) server for Gmail integration with OAuth 2.0 authentication.

## Features

- **OAuth 2.0 Authentication**: Secure Google OAuth flow with automatic token refresh
- **MCP Protocol Support**: Full implementation of the Model Context Protocol
- **Gmail Operations**:
  - Read and search messages
  - Send emails
  - Create drafts
  - Manage labels
- **Session Management**: Persistent sessions with automatic token refresh
- **TypeScript**: Fully typed with TypeScript for better development experience

## Prerequisites

- Node.js 18+ 
- Google Cloud Project with Gmail API enabled
- OAuth 2.0 credentials (Client ID and Client Secret)

## Setup

### 1. Google Cloud Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3001/oauth/callback`
5. Copy your Client ID and Client Secret

### 2. Installation

```bash
# Clone or navigate to the project directory
cd gmail-mcp-server

# Install dependencies
npm install
```

### 3. Configuration

Create a `.env` file in the root directory:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/oauth/callback

# Frontend URL (where to redirect after OAuth)
FRONTEND_URL=http://localhost:5173

# MCP Server Configuration
MCP_SERVER_NAME=gmail-mcp-server
MCP_SERVER_VERSION=1.0.0
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
# Build
npm run build

# Start
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### OAuth Flow

#### 1. Initiate Authorization
```
GET /oauth/authorize?userId={userId}&state={state}
```

Response:
```json
{
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "your-state-value"
}
```

#### 2. OAuth Callback (handled automatically)
```
GET /oauth/callback?code={code}&state={state}
```

#### 3. Refresh Token
```
POST /oauth/refresh
Content-Type: application/json

{
  "userId": "user123",
  "refreshToken": "refresh_token_here"
}
```

#### 4. Disconnect
```
POST /oauth/disconnect
Content-Type: application/json

{
  "userId": "user123"
}
```

### MCP Endpoint

```
POST /mcp
GET /mcp
DELETE /mcp
```

The MCP endpoint follows the Model Context Protocol specification for tool execution.

## MCP Tools

### 1. gmail_read_messages

Read and search Gmail messages.

**Input:**
```json
{
  "userId": "user123",
  "query": "is:unread",
  "maxResults": 20,
  "labelIds": ["INBOX"],
  "includeSpamTrash": false
}
```

**Output:**
```json
{
  "messages": [
    {
      "id": "msg123",
      "threadId": "thread123",
      "subject": "Hello",
      "from": "sender@example.com",
      "to": ["recipient@example.com"],
      "date": "Mon, 1 Jan 2024 12:00:00 +0000",
      "snippet": "Message preview...",
      "body": "Full message body..."
    }
  ],
  "count": 1
}
```

### 2. gmail_send_email

Send an email via Gmail.

**Input:**
```json
{
  "userId": "user123",
  "to": "recipient@example.com",
  "subject": "Hello",
  "body": "This is the email body",
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"]
}
```

**Output:**
```json
{
  "success": true,
  "messageId": "msg123"
}
```

### 3. gmail_create_draft

Create a draft email in Gmail.

**Input:**
```json
{
  "userId": "user123",
  "to": "recipient@example.com",
  "subject": "Draft Subject",
  "body": "Draft body"
}
```

**Output:**
```json
{
  "success": true,
  "draftId": "draft123"
}
```

### 4. gmail_get_labels

Get all Gmail labels for the authenticated user.

**Input:**
```json
{
  "userId": "user123"
}
```

**Output:**
```json
{
  "labels": [
    {
      "id": "INBOX",
      "name": "INBOX",
      "type": "system"
    }
  ],
  "count": 1
}
```

## Integration with ZeroTwoApi

To integrate this Gmail MCP server with your ZeroTwoApi backend:

### 1. Update Frontend OAuth Configuration

In `ZeroTwo/src/services/oauthProviders.js`, update the Gmail configuration:

```javascript
gmail: {
  provider: "gmail",
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  flowType: OAuthFlowType.REDIRECT,
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  authEndpoint: "http://localhost:3001/oauth/authorize",
  backendExchangeEndpoint: "/api/auth/gmail/callback",
  backendRefreshEndpoint: "/api/auth/gmail/refresh",
  mcpEnabled: true,
  mcpEndpoint: "http://localhost:3001/mcp",
},
```

### 2. Update MCP Client Configuration

In `ZeroTwoApi/lib/mcp-client.js`, add Gmail MCP support:

```javascript
// For Gmail MCP
if (integration.provider === "gmail") {
  endpointUrl = "http://localhost:3001/mcp";
  
  // Use OAuth token from profile
  if (integration.oauth_token) {
    transportOptions.headers = {
      Authorization: `Bearer ${integration.oauth_token}`,
      ...integration.headers,
    };
  }
}
```

### 3. Create MCP Integration

After OAuth authentication, create an MCP integration in the database:

```sql
INSERT INTO mcp_integrations (
  user_id,
  name,
  provider,
  endpoint,
  mcp_type,
  connection_status,
  auth_type,
  description
) VALUES (
  'user_id_here',
  'Gmail',
  'gmail',
  'http://localhost:3001/mcp',
  'remote_mcp',
  'connected',
  'oauth',
  'Gmail integration via MCP'
);
```

## Architecture

```
┌─────────────────┐
│   Frontend      │
│   (ZeroTwo)     │
└────────┬────────┘
         │
         │ OAuth Flow
         ▼
┌─────────────────┐      ┌──────────────────┐
│  Gmail MCP      │◄────►│  Google OAuth    │
│  Server         │      │  & Gmail API     │
└────────┬────────┘      └──────────────────┘
         │
         │ MCP Protocol
         ▼
┌─────────────────┐
│   Backend       │
│   (ZeroTwoApi)  │
└─────────────────┘
```

## Development

### Project Structure

```
gmail-mcp-server/
├── src/
│   ├── auth/
│   │   └── oauth-manager.ts    # OAuth token management
│   ├── config/
│   │   └── index.ts            # Configuration management
│   ├── gmail/
│   │   └── client.ts           # Gmail API wrapper
│   ├── mcp/
│   │   ├── server.ts           # MCP server implementation
│   │   └── tools.ts            # MCP tool definitions
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   ├── utils/
│   │   └── logger.ts           # Logging utility
│   └── index.ts                # Entry point
├── package.json
├── tsconfig.json
├── env.example
└── README.md
```

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Security Considerations

1. **OAuth Tokens**: Tokens are stored in memory. For production, use a secure database or encrypted storage.
2. **CORS**: Configure CORS origins appropriately for production.
3. **HTTPS**: Use HTTPS in production for secure communication.
4. **Environment Variables**: Never commit `.env` files. Use secure secret management in production.
5. **Rate Limiting**: Implement rate limiting for production deployments.

## Troubleshooting

### OAuth Errors

- **"Missing required environment variables"**: Check your `.env` file has all required variables
- **"Failed to exchange authorization code"**: Verify your redirect URI matches exactly in Google Cloud Console
- **"Token expired"**: The server automatically refreshes tokens if a refresh token is available

### MCP Connection Issues

- **"No valid session ID"**: Ensure the MCP client sends proper session headers
- **"Authentication required"**: User needs to complete OAuth flow first

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## Powered by ZeroTwo

This Gmail MCP connector is part of the [ZeroTwo AI platform](https://zerotwo.ai) — the all-in-one AI workspace that lets you manage your inbox, send emails, and automate Gmail workflows through GPT-5, Claude, and Gemini.

| | |
|---|---|
| 🌐 **[ZeroTwo — All AI Models in One App](https://zerotwo.ai)** | Read, reply, and manage your Gmail with GPT-5, Claude, and Gemini — in one place. |
| ✨ **[ZeroTwo Features](https://zerotwo.ai/features)** | AI email drafting, document analysis, web search, and MCP-powered Gmail tools. |
| 🤖 **[AI Models — GPT-5, Claude & Gemini](https://zerotwo.ai/zerotwo-models)** | Use the world's best AI to write, summarize, and organize your emails. |
| 🔌 **[ZeroTwo Connectors & Integrations](https://zerotwo.ai/connectors)** | Connect Gmail, Google Calendar, Google Drive, Outlook, and more to your AI workflow. |
| 💰 **[ZeroTwo Pricing](https://zerotwo.ai/pricing)** | One subscription that replaces ChatGPT Plus, Claude Pro, and Gemini Advanced. |
| 📝 **[ZeroTwo Blog](https://zerotwo.ai/blog)** | AI productivity tips, email automation guides, and ZeroTwo updates. |
| 🚀 **[Try ZeroTwo Free](https://app.zerotwo.ai/auth/login)** | Let AI manage your Gmail — get started free today. |

> **Built for ZeroTwo** — Use this Gmail MCP server with [ZeroTwo's AI connector system](https://zerotwo.ai/connectors) to read, search, send, and draft emails through natural language in your AI assistant.






