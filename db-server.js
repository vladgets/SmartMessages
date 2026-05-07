const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');

const DB_PATH = process.env.SERVER_DB_PATH || (process.env.RENDER ? '/data/server.db' : path.join(__dirname, 'data', 'server.db'));

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function init() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      sync_token    TEXT UNIQUE NOT NULL,
      is_admin      INTEGER DEFAULT 0,
      created_at    INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS chats (
      id             INTEGER PRIMARY KEY,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      chat_identifier TEXT NOT NULL,
      display_name   TEXT,
      service_name   TEXT,
      UNIQUE(user_id, chat_identifier)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id                   INTEGER PRIMARY KEY,
      user_id              INTEGER NOT NULL REFERENCES users(id),
      chat_id              INTEGER NOT NULL REFERENCES chats(id),
      guid                 TEXT NOT NULL,
      text                 TEXT,
      date                 REAL NOT NULL,
      is_from_me           INTEGER NOT NULL DEFAULT 0,
      is_read              INTEGER NOT NULL DEFAULT 0,
      service              TEXT,
      cache_has_attachments INTEGER DEFAULT 0,
      sender_handle        TEXT,
      UNIQUE(user_id, guid)
    );

    CREATE INDEX IF NOT EXISTS idx_msg_chat_date ON messages(chat_id, date);
    CREATE INDEX IF NOT EXISTS idx_msg_user_date ON messages(user_id, date);

    CREATE TABLE IF NOT EXISTS labels (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#007AFF',
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS chat_labels (
      chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      label_id   INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (chat_id, label_id)
    );
  `);

  // Migration: add is_admin column to existing databases
  try { db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`); } catch {}
  // First user created is always admin
  db.exec(`UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invites (
      id         INTEGER PRIMARY KEY,
      token      TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
  `);
}

// ── Users ─────────────────────────────────────────────────────────────────────

function createUser(username, passwordHash) {
  const token = 'sm_' + crypto.randomBytes(24).toString('hex');
  getDb().prepare(
    `INSERT INTO users (username, password_hash, sync_token) VALUES (?, ?, ?)`
  ).run(username, passwordHash, token);
  return token;
}

function getUserByUsername(username) {
  return getDb().prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

function getUserById(id) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

function getUserByToken(token) {
  return getDb().prepare(`SELECT * FROM users WHERE sync_token = ?`).get(token);
}

// ── Sync ──────────────────────────────────────────────────────────────────────

function syncMessages(userId, messages) {
  const db = getDb();

  const insertChat = db.prepare(`
    INSERT OR IGNORE INTO chats (user_id, chat_identifier, display_name, service_name)
    VALUES (?, ?, ?, ?)
  `);
  const updateChatName = db.prepare(`
    UPDATE chats SET display_name = ?
    WHERE user_id = ? AND chat_identifier = ? AND (display_name IS NULL OR display_name = '')
  `);
  const getChat = db.prepare(`
    SELECT id FROM chats WHERE user_id = ? AND chat_identifier = ?
  `);
  const insertMsg = db.prepare(`
    INSERT OR IGNORE INTO messages
      (user_id, chat_id, guid, text, date, is_from_me, is_read, service, cache_has_attachments, sender_handle)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let accepted = 0;
  const run = db.transaction(() => {
    const chatCache = new Map();
    for (const m of messages) {
      const key = `${m.chat_identifier}`;
      if (!chatCache.has(key)) {
        insertChat.run(userId, m.chat_identifier, m.display_name || '', m.service_name);
        if (m.display_name) updateChatName.run(m.display_name, userId, m.chat_identifier);
        chatCache.set(key, getChat.get(userId, m.chat_identifier).id);
      }
      const r = insertMsg.run(
        userId,
        chatCache.get(key),
        m.guid,
        m.text || null,
        m.date,
        m.is_from_me ? 1 : 0,
        m.is_read    ? 1 : 0,
        m.service,
        m.cache_has_attachments ? 1 : 0,
        m.sender_handle || null
      );
      accepted += r.changes;
    }
  });

  run();
  return accepted;
}

// ── Read ──────────────────────────────────────────────────────────────────────

function getConversations(userId, labelId = null) {
  const db = getDb();
  let sql = `
    SELECT
      c.id                                                       AS chat_id,
      c.chat_identifier,
      COALESCE(NULLIF(c.display_name, ''), c.chat_identifier)    AS display_name,
      c.service_name,
      lm.text                                                    AS last_text,
      lm.date                                                    AS last_date,
      lm.is_from_me                                              AS last_is_from_me,
      lm.cache_has_attachments,
      (SELECT COUNT(*) FROM messages m2
       WHERE m2.chat_id = c.id AND m2.is_from_me = 0 AND m2.is_read = 0) AS unread_count
    FROM chats c
    JOIN (
      SELECT chat_id, text, date, is_from_me, cache_has_attachments,
             ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY date DESC) AS rn
      FROM messages WHERE user_id = ?
    ) lm ON c.id = lm.chat_id AND lm.rn = 1
    WHERE c.user_id = ?
  `;
  const params = [userId, userId];
  if (labelId) {
    sql += ` AND EXISTS (SELECT 1 FROM chat_labels cl WHERE cl.chat_id = c.id AND cl.label_id = ?)`;
    params.push(labelId);
  }
  sql += ` ORDER BY lm.date DESC`;

  const rows = db.prepare(sql).all(...params);

  const labelsMap = {};
  if (rows.length) {
    const chatIds = rows.map(r => r.chat_id);
    const chatLabels = db.prepare(`
      SELECT cl.chat_id, l.id, l.name, l.color
      FROM chat_labels cl
      JOIN labels l ON l.id = cl.label_id
      WHERE cl.chat_id IN (${chatIds.map(() => '?').join(',')})
    `).all(...chatIds);
    for (const row of chatLabels) {
      if (!labelsMap[row.chat_id]) labelsMap[row.chat_id] = [];
      labelsMap[row.chat_id].push({ id: row.id, name: row.name, color: row.color });
    }
  }

  return rows.map(r => ({
    chat_id:         r.chat_id,
    display_name:    r.display_name,
    service_name:    r.service_name,
    last_text:       r.last_text || (r.cache_has_attachments ? '📎 Attachment' : ''),
    last_date:       r.last_date,
    chat_identifier: r.chat_identifier,
    last_is_from_me: !!r.last_is_from_me,
    unread_count:    r.unread_count,
    labels:          labelsMap[r.chat_id] || [],
  }));
}

function markChatRead(userId, chatId) {
  getDb().prepare(`
    UPDATE messages SET is_read = 1
    WHERE chat_id = ? AND user_id = ? AND is_from_me = 0 AND is_read = 0
  `).run(chatId, userId);
}

function getMessages(userId, chatId) {
  const chat = getDb().prepare(`SELECT id FROM chats WHERE id = ? AND user_id = ?`).get(chatId, userId);
  if (!chat) return [];

  return getDb().prepare(`
    SELECT id AS message_id, text, date, is_from_me, service, sender_handle, cache_has_attachments
    FROM messages
    WHERE chat_id = ? AND user_id = ?
    ORDER BY date ASC
  `).all(chatId, userId)
    .map(r => ({
      message_id:  r.message_id,
      text:        r.text || (r.cache_has_attachments ? '📎 Attachment' : null),
      date:        r.date,
      is_from_me:  !!r.is_from_me,
      service:     r.service,
      sender_id:   r.sender_handle,
    }))
    .filter(m => m.text);
}

// ── Labels ────────────────────────────────────────────────────────────────────

function getLabels(userId) {
  return getDb().prepare(`SELECT id, name, color FROM labels WHERE user_id = ? ORDER BY name ASC`).all(userId);
}

function createLabel(userId, name, color) {
  getDb().prepare(`INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)`).run(userId, name, color);
}

function deleteLabel(userId, labelId) {
  getDb().prepare(`DELETE FROM labels WHERE id = ? AND user_id = ?`).run(labelId, userId);
}

function setChatLabels(userId, chatId, labelIds) {
  const db = getDb();
  const chat = db.prepare(`SELECT id FROM chats WHERE id = ? AND user_id = ?`).get(chatId, userId);
  if (!chat) return false;
  db.transaction(() => {
    db.prepare(`DELETE FROM chat_labels WHERE chat_id = ?`).run(chatId);
    const checkLabel = db.prepare(`SELECT id FROM labels WHERE id = ? AND user_id = ?`);
    const insert     = db.prepare(`INSERT OR IGNORE INTO chat_labels (chat_id, label_id) VALUES (?, ?)`);
    for (const labelId of labelIds) {
      if (checkLabel.get(labelId, userId)) insert.run(chatId, labelId);
    }
  })();
  return true;
}

// ── Invites ───────────────────────────────────────────────────────────────────

function createInvite(userId) {
  const token     = crypto.randomBytes(16).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  getDb().prepare(
    `INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, ?)`
  ).run(token, userId, expiresAt);
  return token;
}

function getInvite(token) {
  return getDb().prepare(
    `SELECT * FROM invites WHERE token = ? AND used_at IS NULL AND expires_at > unixepoch()`
  ).get(token);
}

function redeemInvite(inviteToken, username, passwordHash) {
  const db = getDb();
  return db.transaction(() => {
    const invite = db.prepare(
      `SELECT * FROM invites WHERE token = ? AND used_at IS NULL AND expires_at > unixepoch()`
    ).get(inviteToken);
    if (!invite) return null;

    const syncToken = 'sm_' + crypto.randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO users (username, password_hash, sync_token) VALUES (?, ?, ?)`).run(username, passwordHash, syncToken);
    db.prepare(`UPDATE invites SET used_at = unixepoch() WHERE token = ?`).run(inviteToken);
    return syncToken;
  })();
}

function getUsers() {
  return getDb().prepare(`
    SELECT u.id, u.username, u.is_admin, u.created_at,
      (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) AS chat_count,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) AS message_count
    FROM users u ORDER BY u.created_at ASC
  `).all();
}

module.exports = { init, createUser, getUserByUsername, getUserById, getUserByToken, syncMessages, getConversations, getMessages, markChatRead, createInvite, getInvite, redeemInvite, getUsers, getLabels, createLabel, deleteLabel, setChatLabels };
