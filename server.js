import express from 'express';
import { google } from 'googleapis';
import path from 'path';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Middleware
// Trust proxy (needed for secure cookies behind reverse proxies)
if (isProd) app.set('trust proxy', 1);

// Security & perf middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

// OAuth2 Client Configuration
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// In-memory storage (use database in production)
const userSessions = new Map();

// Utility function to generate random state
function generateState() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// Helpers to decode and extract Gmail message bodies
function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(normalized, 'base64');
  return buf.toString('utf8');
}

function extractBodyFromPayload(payload) {
  // Returns { text, html }
  if (!payload) return { text: '', html: '' };

  // If direct body data exists
  if (payload.body && payload.body.data) {
    const content = decodeBase64Url(payload.body.data);
    if ((payload.mimeType || '').includes('text/plain')) {
      return { text: content, html: '' };
    }
    if ((payload.mimeType || '').includes('text/html')) {
      return { text: '', html: content };
    }
  }

  const parts = payload.parts || [];
  let text = '';
  let html = '';

  const walk = (ps) => {
    if (!ps) return;
    for (const p of ps) {
      if (p.parts && p.parts.length) walk(p.parts);
      if (p.body && p.body.data) {
        const content = decodeBase64Url(p.body.data);
        if (!text && (p.mimeType || '').includes('text/plain')) {
          text = content;
        }
        if (!html && (p.mimeType || '').includes('text/html')) {
          html = content;
        }
      }
    }
  };
  walk(parts);
  return { text, html };
}

// Routes

/**
 * Homepage - Check authentication status and show appropriate view
 */
app.get('/', (req, res) => {
  const sessionId = req.query.session || req.cookies?.sessionId;
  const userData = sessionId ? userSessions.get(sessionId) : null;

  res.render('index', {
    title: 'Gmail API Test Application',
    authenticated: !!userData,
    userEmail: userData?.profile?.email || userData?.profile?.emailAddress,
    sessionId: sessionId,
  });
});

/**
 * Initiate OAuth 2.0 Flow
 * Redirects user to Google's authorization server
 */
app.get('/auth', (req, res) => {
  const state = generateState();

  // Generate the authorization URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.labels',
      'profile',
      'email',
    ],
    prompt: 'consent',
    state: state,
  });

  // Store state in session for validation
  const sessionId = generateState();
  userSessions.set(sessionId, { state, tokens: null, profile: null });

  const cookieOptions = { maxAge: 900000, httpOnly: true, sameSite: 'lax', secure: isProd };
  res.cookie('sessionId', sessionId, cookieOptions);
  res.redirect(authUrl);
});

/**
 * OAuth 2.0 Callback Handler
 * Exchanges authorization code for access tokens
 */
app.get('/oauth2callback', async (req, res) => {
  const { code, state } = req.query;
  const sessionId = req.cookies?.sessionId;

  if (!sessionId || !userSessions.has(sessionId)) {
    return res.status(400).send('Invalid session. Please start over.');
  }

  const userSession = userSessions.get(sessionId);

  // Validate state parameter to prevent CSRF
  if (userSession.state !== state) {
    return res
      .status(400)
      .send('State parameter mismatch. Possible CSRF attack.');
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Get user profile information
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const profile = await oauth2.userinfo.get();

    // Update user session with tokens and profile
    userSession.tokens = tokens;
    userSession.profile = profile.data;
    userSessions.set(sessionId, userSession);

    console.log('✅ User authenticated:', profile.data.email);
    console.log('📧 Access Token:', tokens.access_token ? 'Received' : 'Missing');
    console.log(
      '🔄 Refresh Token:',
      tokens.refresh_token ? 'Received' : 'Missing'
    );

    res.redirect('/dashboard');
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    res.status(500).render('error', {
      title: 'Authentication Failed',
      error: 'Failed to authenticate with Google. Please try again.',
    });
  }
});

/**
 * Dashboard - Main application interface after authentication
 */
app.get('/dashboard', async (req, res) => {
  const sessionId = req.cookies?.sessionId;
  const userSession = sessionId ? userSessions.get(sessionId) : null;

  if (!userSession || !userSession.tokens) {
    return res.redirect('/auth');
  }

  try {
    // Set credentials for API calls
    oAuth2Client.setCredentials(userSession.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Get user profile
    const profile = await gmail.users.getProfile({ userId: 'me' });

    // Get recent emails
    const messages = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 15,
      q: 'in:inbox',
    });

    // Get labels
    const labels = await gmail.users.labels.list({ userId: 'me' });

    res.render('dashboard', {
      profile: profile.data,
      messages: messages.data.messages || [],
      labels: labels.data.labels || [],
      tokens: userSession.tokens,
      userProfile: userSession.profile,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', {
      title: 'Dashboard Error',
      error: 'Failed to load dashboard data. Please try reauthenticating.',
    });
  }
});

/**
 * Send Test Email Endpoint
 */
app.post('/send-test-email', async (req, res) => {
  const sessionId = req.cookies?.sessionId;
  const userSession = sessionId ? userSessions.get(sessionId) : null;

  if (!userSession || !userSession.tokens) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    oAuth2Client.setCredentials(userSession.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const {
      to,
      subject = 'Test Email from Gmail OAuth App',
      body = 'This is a test email sent from our Node.js Gmail OAuth application!',
    } = req.body;

    const fromEmail = userSession.profile.email || userSession.profile.emailAddress;
    const fromName = userSession.profile.name || 'User';

    const emailLines = [
      `From: "${fromName}" <${fromEmail}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '',
      '---',
      `Sent via Gmail OAuth Test App at ${new Date().toISOString()}`,
    ];

    const encodedMessage = Buffer.from(emailLines.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    res.json({
      success: true,
      message: 'Test email sent successfully!',
      messageId: result.data.id,
      threadId: result.data.threadId,
    });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get Email Details
 */
app.get('/api/emails/:id', async (req, res) => {
  const sessionId = req.cookies?.sessionId;
  const userSession = sessionId ? userSessions.get(sessionId) : null;
  
  if (!userSession || !userSession.tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    oAuth2Client.setCredentials(userSession.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const wantFull = (req.query.format || '').toString().toLowerCase() === 'full';
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: wantFull ? 'full' : 'metadata',
    });

    if (wantFull) {
      const { text, html } = extractBodyFromPayload(message.data.payload);
      return res.json({ ...message.data, decodedBodyText: text || '', decodedBodyHtml: html || '' });
    }

    res.json(message.data);
  } catch (error) {
    console.error('Get email error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Refresh Tokens Endpoint (if access token expires)
 */
app.post('/refresh-tokens', async (req, res) => {
  const sessionId = req.cookies?.sessionId;
  const userSession = sessionId ? userSessions.get(sessionId) : null;

  if (!userSession || !userSession.tokens?.refresh_token) {
    return res.status(401).json({ error: 'No refresh token available' });
  }

  try {
    oAuth2Client.setCredentials({
      refresh_token: userSession.tokens.refresh_token,
    });

    // googleapis v126 deprecates refreshAccessToken(); using getAccessToken() refresh flow via setCredentials
    const tokenResponse = await oAuth2Client.refreshAccessToken?.();
    if (tokenResponse?.credentials) {
      userSession.tokens = { ...userSession.tokens, ...tokenResponse.credentials };
    } else {
      const { token } = await oAuth2Client.getAccessToken();
      if (token) userSession.tokens.access_token = token;
    }
    userSessions.set(sessionId, userSession);

    res.json({ success: true, message: 'Tokens refreshed successfully' });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh tokens' });
  }
});

/**
 * Logout - Clear user session
 */
app.get('/logout', (req, res) => {
  const sessionId = req.cookies?.sessionId;
  
  if (sessionId) {
    userSessions.delete(sessionId);
  }
  const cookieOptions = { maxAge: 900000, httpOnly: true, sameSite: 'lax', secure: isProd };
  res.clearCookie('sessionId', cookieOptions);
  res.redirect('/');
});

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Gmail OAuth Test Application running!\n📍 Local: http://localhost:${PORT}\n🔑 Make sure you have:\n   - Google Cloud Console OAuth credentials configured\n   - Gmail API enabled\n   - Redirect URI: http://localhost:3000/oauth2callback\n\n📖 To get started:\n   1. Visit http://localhost:${PORT}\n   2. Click "Authenticate with Google"\n   3. Grant permissions in Google consent screen\n   4. Test Gmail functionality in the dashboard\n  `);
});

export default app;

// Centralized error handler (last)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).render('error', {
    title: 'Server Error',
    error: isProd ? 'An unexpected error occurred.' : (err?.message || 'Error')
  });
});
