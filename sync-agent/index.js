#!/usr/bin/env node
/**
 * Smart Messages — Mac sync agent
 * Reads ~/Library/Messages/chat.db and pushes new messages to the server.
 * No npm dependencies — uses macOS built-in sqlite3 CLI and Node.js fetch.
 *
 * Run manually:  node sync-agent/index.js
 * Or install as a launchd service: bash sync-agent/install.sh
 */

const { execFileSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const path = require('path');
const os   = require('os');

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH  = path.join(__dirname, 'config.json');
const CHAT_DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const BATCH_SIZE   = 500;
const APPLE_EPOCH  = 978307200; // Unix timestamp of 2001-01-01

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Config not found at ${CONFIG_PATH}`);
    console.error('Run: bash sync-agent/install.sh');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ─── SQLite helpers ───────────────────────────────────────────────────────────

function queryDb(sql, params = []) {
  // Replace ? placeholders with escaped values for the CLI
  let i = 0;
  const escaped = sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });

  try {
    const out = execFileSync('sqlite3', ['-json', '-readonly', CHAT_DB_PATH, escaped], {
      maxBuffer: 50 * 1024 * 1024, // 50 MB
      timeout: 30000,
    });
    if (!out || !out.length) return [];
    return JSON.parse(out.toString());
  } catch (err) {
    // sqlite3 returns exit code 1 when query returns no rows in some versions
    if (err.stdout && err.stdout.length > 2) return JSON.parse(err.stdout.toString());
    return [];
  }
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

// Convert Unix timestamp to Apple nanoseconds format
function toAppleTs(unixTs) {
  return (unixTs - APPLE_EPOCH) * 1_000_000_000;
}

function fetchNewMessages(lastSyncUnix) {
  const lastAppleTs = toAppleTs(lastSyncUnix);

  return queryDb(`
    SELECT
      m.guid,
      m.text,
      CAST(m.date AS REAL) / 1000000000.0 + ${APPLE_EPOCH}  AS date,
      m.is_from_me,
      m.is_read,
      m.service,
      m.cache_has_attachments,
      m.item_type,
      h.id                                                    AS sender_handle,
      c.chat_identifier,
      COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) AS display_name,
      c.service_name
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c                ON cmj.chat_id = c.ROWID
    LEFT JOIN handle h         ON m.handle_id = h.ROWID
    WHERE m.item_type = 0
      AND m.date > ${lastAppleTs}
    ORDER BY m.date ASC
    LIMIT ${BATCH_SIZE}
  `);
}

async function pushMessages(serverUrl, token, messages) {
  const res = await fetch(`${serverUrl}/api/sync`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-sync-token':  token,
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  const { serverUrl, token } = cfg;
  let lastSync = cfg.lastSync || 0; // Unix timestamp

  if (!serverUrl || !token) {
    console.error('config.json is missing serverUrl or token. Run install.sh again.');
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Starting sync from ${new Date(lastSync * 1000).toISOString()}`);

  let totalSynced = 0;
  let latestDate  = lastSync;

  // Fetch in batches until caught up
  while (true) {
    const rows = fetchNewMessages(latestDate);
    if (!rows.length) break;

    // Map to server payload format
    const messages = rows
      .filter(r => r.text || r.cache_has_attachments)
      .map(r => ({
        guid:                 r.guid,
        chat_identifier:      r.chat_identifier,
        display_name:         r.display_name || '',
        service_name:         r.service_name,
        text:                 r.text || null,
        date:                 r.date,
        is_from_me:           !!r.is_from_me,
        is_read:              !!r.is_read,
        service:              r.service,
        cache_has_attachments: !!r.cache_has_attachments,
        sender_handle:        r.sender_handle || null,
      }));

    if (messages.length) {
      const result = await pushMessages(serverUrl, token, messages);
      totalSynced += result.accepted;
    }

    // Advance the cursor by the max date in this batch
    latestDate = Math.max(...rows.map(r => r.date));

    // Persist progress after each batch
    cfg.lastSync = latestDate;
    saveConfig(cfg);

    if (rows.length < BATCH_SIZE) break; // last batch
  }

  console.log(`[${new Date().toISOString()}] Done — ${totalSynced} new messages synced.`);
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] Sync failed:`, err.message);
  process.exit(1);
});
