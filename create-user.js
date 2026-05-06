#!/usr/bin/env node
const bcrypt = require('bcryptjs');
const db     = require('./db-server');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node create-user.js <username> <password>');
  process.exit(1);
}

db.init();

const existing = db.getUserByUsername(username);
if (existing) {
  console.error(`Error: user "${username}" already exists`);
  process.exit(1);
}

const hash  = bcrypt.hashSync(password, 12);
const token = db.createUser(username, hash);

console.log(`\nUser created successfully!`);
console.log(`  Username:   ${username}`);
console.log(`  Sync token: ${token}\n`);
console.log(`Copy this token — you'll need it to configure the sync agent on your Mac.\n`);
