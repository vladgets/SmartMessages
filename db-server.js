const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');

const DB_PATH = process.env.SERVER_DB_PATH || path.join(__dirname, 'data', 'server.db');

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

function getConversations(userId) {
  const rows = getDb().prepare(`
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
    ORDER BY lm.date DESC
  `).all(userId, userId);

  return rows.map(r => ({
    chat_id:         r.chat_id,
    display_name:    r.display_name,
    service_name:    r.service_name,
    last_text:       r.last_text || (r.cache_has_attachments ? '📎 Attachment' : ''),
    last_date:       r.last_date,
    last_is_from_me: !!r.last_is_from_me,
    unread_count:    r.unread_count,
  }));
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

module.exports = { init, createUser, getUserByUsername, getUserById, getUserByToken, syncMessages, getConversations, getMessages };
