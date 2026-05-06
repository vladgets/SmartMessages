const express      = require('express');
const cookieSession = require('cookie-session');
const bcrypt       = require('bcryptjs');
const archiver     = require('archiver');
const path         = require('path');
const fs           = require('fs');
const db           = require('./db-server');

const app  = express();
const PORT = process.env.PORT || 3000;

db.init();

app.use(express.json({ limit: '50mb' }));
app.use(cookieSession({
  name:   'sm_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  sameSite: 'lax',
  httpOnly: true,
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware ────────────────────────────────────────────────────────────────

function requireSession(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireToken(req, res, next) {
  const token = req.headers['x-sync-token'];
  if (!token) return res.status(401).json({ error: 'Missing sync token' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  req.syncUser = user;
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ status: 'ok' });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username });
});

// ── Sync token ────────────────────────────────────────────────────────────────

app.get('/api/sync/token', requireSession, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.json({ token: user.sync_token });
});

// ── Sync endpoint (Mac agent → server) ───────────────────────────────────────

app.post('/api/sync', requireToken, (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'Expected { messages: [...] }' });

  const accepted = db.syncMessages(req.syncUser.id, messages);
  console.log(`[sync] user=${req.syncUser.username} received=${messages.length} accepted=${accepted}`);
  res.json({ status: 'ok', accepted });
});

// ── Sync agent download ───────────────────────────────────────────────────────

app.get('/api/download/sync-agent', requireSession, (req, res) => {
  const user      = db.getUserById(req.session.userId);
  const serverUrl = `${req.protocol}://${req.get('host')}`;

  const config = JSON.stringify({ serverUrl, token: user.sync_token, lastSync: 0 }, null, 2);

  const readme = `Smart Messages — Sync Agent
===========================

Your sync agent is pre-configured and ready to install.

Steps:
  1. Open Terminal (search "Terminal" in Spotlight, or Cmd+Space → type Terminal)
  2. In Terminal, type:  bash  (with a space after it)
  3. Drag "install.sh" from this folder into the Terminal window
  4. Press Enter — choose how often to sync, and you're done!

Messages will sync automatically in the background on every login.

Troubleshoot:
  tail -f /tmp/smartmessages-sync.log

Uninstall:
  bash uninstall.sh
`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="SmartMessages-SyncAgent.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  const agentDir = path.join(__dirname, 'sync-agent');
  archive.file(path.join(agentDir, 'index.js'),     { name: 'SmartMessages-SyncAgent/index.js' });
  archive.file(path.join(agentDir, 'install.sh'),   { name: 'SmartMessages-SyncAgent/install.sh' });
  archive.file(path.join(agentDir, 'uninstall.sh'), { name: 'SmartMessages-SyncAgent/uninstall.sh' });
  archive.append(config,  { name: 'SmartMessages-SyncAgent/config.json' });
  archive.append(readme,  { name: 'SmartMessages-SyncAgent/README.txt' });

  archive.finalize();
});

// ── Invites ───────────────────────────────────────────────────────────────────

app.post('/api/invites', requireSession, (req, res) => {
  const token = db.createInvite(req.session.userId);
  const url   = `${req.protocol}://${req.get('host')}/invite/${token}`;
  res.json({ token, url });
});

app.get('/api/invites/:token', (req, res) => {
  const invite = db.getInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
  res.json({ valid: true });
});

app.post('/api/invites/:token/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)   return res.status(400).json({ error: 'Missing fields' });
  if (username.length < 2)      return res.status(400).json({ error: 'Username too short' });
  if (password.length < 6)      return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.getUserByUsername(username)) return res.status(400).json({ error: 'Username already taken' });

  const hash      = bcrypt.hashSync(password, 12);
  const syncToken = db.redeemInvite(req.params.token, username, hash);
  if (!syncToken) return res.status(410).json({ error: 'Invite expired or already used' });

  const user = db.getUserByUsername(username);
  req.session.userId = user.id;
  res.json({ username: user.username });
});

// Serve SPA for invite URLs
app.get('/invite/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Read endpoints ────────────────────────────────────────────────────────────

app.get('/api/conversations', requireSession, (req, res) => {
  res.json(db.getConversations(req.session.userId));
});

app.get('/api/conversations/:chatId/messages', requireSession, (req, res) => {
  res.json(db.getMessages(req.session.userId, Number(req.params.chatId)));
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Smart Messages running on http://localhost:${PORT}`));
