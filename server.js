const express      = require('express');
const cookieSession = require('cookie-session');
const bcrypt       = require('bcryptjs');
const path         = require('path');
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

// ── Read endpoints ────────────────────────────────────────────────────────────

app.get('/api/conversations', requireSession, (req, res) => {
  res.json(db.getConversations(req.session.userId));
});

app.get('/api/conversations/:chatId/messages', requireSession, (req, res) => {
  res.json(db.getMessages(req.session.userId, Number(req.params.chatId)));
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Smart Messages running on http://localhost:${PORT}`));
