/**
 * OAuth Manager for handling Google OAuth 2.0 authentication
 */

import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { OAuthTokens, SessionData } from '../types/index.js';

export class OAuthManager {
  private oauth2Client;
  private sessions: Map<string, SessionData>;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    this.sessions = new Map();
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: config.gmail.scopes,
      state,
      prompt: 'consent', // Force consent to get refresh token
    });

    logger.info('[OAuthManager] Generated authorization URL', { state });
    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    try {
      logger.info('[OAuthManager] Exchanging code for tokens');

      const { tokens } = await this.oauth2Client.getToken(code);

      logger.info('[OAuthManager] Successfully exchanged code for tokens');

    return {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token || undefined,
      expires_in: tokens.expiry_date
        ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
        : 3600,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || undefined,
    };
  } catch (error) {
      logger.error('[OAuthManager] Error exchanging code for tokens:', error);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    try {
      logger.info('[OAuthManager] Refreshing access token');

      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      logger.info('[OAuthManager] Successfully refreshed access token');

      return {
        access_token: credentials.access_token!,
        refresh_token: refreshToken, // Keep the same refresh token
        expires_in: credentials.expiry_date
          ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
          : 3600,
        token_type: credentials.token_type || 'Bearer',
        scope: credentials.scope,
      };
    } catch (error) {
      logger.error('[OAuthManager] Error refreshing access token:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Store session data
   */
  storeSession(userId: string, tokens: OAuthTokens): void {
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : undefined;

    const sessionData: SessionData = {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      createdAt: new Date(),
    };

    this.sessions.set(userId, sessionData);
    logger.info('[OAuthManager] Stored session for user', { userId });
  }

  /**
   * Get session data
   */
  getSession(userId: string): SessionData | undefined {
    return this.sessions.get(userId);
  }

  /**
   * Check if session is valid (not expired)
   */
  isSessionValid(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (!session) {
      return false;
    }

    if (!session.expiresAt) {
      return true; // No expiration set
    }

    return session.expiresAt > new Date();
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(userId: string): Promise<string | null> {
    const session = this.sessions.get(userId);
    if (!session) {
      logger.warn('[OAuthManager] No session found for user', { userId });
      return null;
    }

    // Check if token is still valid
    if (this.isSessionValid(userId)) {
      return session.accessToken;
    }

    // Token expired, try to refresh
    if (!session.refreshToken) {
      logger.warn('[OAuthManager] No refresh token available for user', { userId });
      return null;
    }

    try {
      const newTokens = await this.refreshAccessToken(session.refreshToken);
      this.storeSession(userId, newTokens);
      return newTokens.access_token;
    } catch (error) {
      logger.error('[OAuthManager] Failed to refresh token for user', { userId, error });
      return null;
    }
  }

  /**
   * Remove session
   */
  removeSession(userId: string): void {
    this.sessions.delete(userId);
    logger.info('[OAuthManager] Removed session for user', { userId });
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// Singleton instance
export const oauthManager = new OAuthManager();

