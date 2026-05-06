const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

const app    = express();
const PORT   = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');

const upload = multer({ dest: path.join(__dirname, 'data', 'tmp') });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Apple timestamp helpers ──────────────────────────────────────────────────
const APPLE_EPOCH = 978307200; // seconds from Unix epoch to 2001-01-01

function appleTs(ts) {
  if (!ts) return null;
  return ts / 1_000_000_000 + APPLE_EPOCH;
}

// ─── DB queries ───────────────────────────────────────────────────────────────
function getConversations() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT
        c.ROWID                                                   AS chat_id,
        c.chat_identifier,
        COALESCE(NULLIF(c.display_name, ''), c.chat_identifier)   AS display_name,
        c.service_name,
        lm.text                                                   AS last_text,
        lm.date                                                   AS last_date,
        lm.is_from_me                                             AS last_is_from_me,
        lm.cache_has_attachments,
        (
          SELECT COUNT(*) FROM message m2
          JOIN chat_message_join cmj2 ON m2.ROWID = cmj2.message_id
          WHERE cmj2.chat_id = c.ROWID
            AND m2.is_read   = 0
            AND m2.is_from_me = 0
            AND m2.item_type  = 0
        ) AS unread_count
      FROM chat c
      JOIN (
        SELECT cmj.chat_id, m.text, m.date, m.is_from_me, m.cache_has_attachments,
               ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) AS rn
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE m.item_type = 0
      ) lm ON c.ROWID = lm.chat_id AND lm.rn = 1
      ORDER BY lm.date DESC
    `).all();

    return rows.map(r => ({
      chat_id:       r.chat_id,
      display_name:  r.display_name,
      service_name:  r.service_name,
      last_text:     r.last_text || (r.cache_has_attachments ? '📎 Attachment' : ''),
      last_date:     appleTs(r.last_date),
      last_is_from_me: !!r.last_is_from_me,
      unread_count:  r.unread_count,
    }));
  } finally {
    db.close();
  }
}

function getMessages(chatId) {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT
        m.ROWID                   AS message_id,
        m.text,
        m.date,
        m.is_from_me,
        m.service,
        m.cache_has_attachments,
        h.id                      AS sender_id
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE cmj.chat_id = ?
        AND m.item_type = 0
      ORDER BY m.date ASC
    `).all(chatId);

    return rows
      .map(r => ({
        message_id: r.message_id,
        text:       r.text || (r.cache_has_attachments ? '📎 Attachment' : null),
        date:       appleTs(r.date),
        is_from_me: !!r.is_from_me,
        service:    r.service,
        sender_id:  r.sender_id,
      }))
      .filter(m => m.text);
  } finally {
    db.close();
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ hasDb: fs.existsSync(DB_PATH) });
});

app.get('/api/conversations', (req, res) => {
  if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'No database' });
  res.json(getConversations());
});

app.get('/api/conversations/:chatId/messages', (req, res) => {
  if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'No database' });
  res.json(getMessages(Number(req.params.chatId)));
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.renameSync(req.file.path, DB_PATH);
  res.json({ status: 'ok' });
});

app.listen(PORT, () => console.log(`Smart Messages running on http://localhost:${PORT}`));
