#!/usr/bin/env node
/**
 * Creates a demo user and seeds 15 mock conversations for UI demos.
 * Usage: node seed-demo.js
 */

const bcrypt = require('bcryptjs');
const db = require('./db-server');

const DEMO_USERNAME = 'demo';
const DEMO_PASSWORD = 'SmartMsg2026!';

// May 6 2026 noon UTC
const NOW = 1778025600;
const H = 3600;
const D = 86400;

function ts(daysAgo, hoursAgo = 0, minutesAgo = 0) {
  return NOW - daysAgo * D - hoursAgo * H - minutesAgo * 60;
}

function msg(chat_identifier, display_name, service_name, guid_prefix, messages) {
  return messages.map(([minuteOffset, text, is_from_me, sender_handle], i) => ({
    chat_identifier,
    display_name,
    service_name,
    guid: `mock-${guid_prefix}-${i}`,
    text,
    date: minuteOffset,
    is_from_me: is_from_me ? 1 : 0,
    is_read: 1,
    service: service_name,
    cache_has_attachments: 0,
    sender_handle: is_from_me ? null : (sender_handle || chat_identifier),
  }));
}

db.init();

// Create or reuse demo user
let user = db.getUserByUsername(DEMO_USERNAME);
if (!user) {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 12);
  const token = db.createUser(DEMO_USERNAME, hash);
  user = db.getUserByUsername(DEMO_USERNAME);
  console.log(`\nCreated user: ${DEMO_USERNAME}`);
  console.log(`Password:     ${DEMO_PASSWORD}`);
  console.log(`Sync token:   ${token}\n`);
} else {
  console.log(`\nUser "${DEMO_USERNAME}" already exists — adding messages.\n`);
}

const userId = user.id;

const conversations = [
  // 1. Mom
  msg('+14155550101', 'Mom', 'iMessage', 'mom', [
    [ts(0, 2, 30), 'Hey honey, are you coming home for the weekend?', false],
    [ts(0, 2, 15), 'Yes! Arriving Saturday around 3pm 🙂', true],
    [ts(0, 2, 0),  'Amazing! I\'ll make your favorite lasagna', false],
    [ts(0, 1, 50), 'You\'re the best mom 😍', true],
    [ts(0, 1, 40), 'Drive safe! Love you', false],
  ]),

  // 2. Alex Chen (work colleague)
  msg('+14155550102', 'Alex Chen', 'iMessage', 'alex', [
    [ts(0, 4, 0),  'Hey, did you finish the Q2 deck?', false],
    [ts(0, 3, 45), 'Almost done, just polishing the revenue slide', true],
    [ts(0, 3, 30), 'We need it by 3pm for the investor call', false],
    [ts(0, 3, 20), 'I\'ll have it to you by 2', true],
    [ts(0, 3, 10), 'You\'re a lifesaver. Thanks!', false],
    [ts(0, 3, 0),  'No worries. Will ping you when it\'s sent', true],
  ]),

  // 3. Sarah (friend, dinner plans)
  msg('+14155550103', 'Sarah', 'iMessage', 'sarah', [
    [ts(1, 6, 0),  'Dinner Saturday? New Italian place on 5th', false],
    [ts(1, 5, 45), 'Oh yes I\'m so in!', true],
    [ts(1, 5, 30), 'Reservations at 7:30, can you make that?', false],
    [ts(1, 5, 15), 'Perfect. Who else is coming?', true],
    [ts(1, 5, 0),  'Jake and Olivia. Maybe Marcus', false],
    [ts(1, 4, 45), 'Great, I\'ll confirm with you Friday', true],
  ]),

  // 4. Dr. Nguyen's Office
  msg('+14085550104', 'Dr. Nguyen\'s Office', 'SMS', 'droffice', [
    [ts(2, 10, 0), 'Reminder: You have an appointment on May 8 at 10:00 AM. Reply YES to confirm or CANCEL to reschedule.', false],
    [ts(2, 9, 55), 'YES', true],
    [ts(2, 9, 50), 'Confirmed! Please arrive 10 min early and bring your insurance card. See you soon!', false],
  ]),

  // 5. Jake (brother, sports)
  msg('+14155550105', 'Jake', 'iMessage', 'jake', [
    [ts(0, 8, 0),  'BRO did you watch the game last night???', false],
    [ts(0, 7, 50), 'I can\'t believe that last-second three 😭', true],
    [ts(0, 7, 40), 'I literally screamed. My neighbors hate me now', false],
    [ts(0, 7, 30), 'lmaoooo 💀 same honestly', true],
    [ts(0, 7, 20), 'Finals bound baby let\'s gooo', false],
    [ts(0, 7, 10), '🏆🏆🏆', true],
  ]),

  // 6. Emma (book club)
  msg('+14155550106', 'Emma', 'iMessage', 'emma', [
    [ts(3, 12, 0), 'Book club is moved to Thursday this week, works?', false],
    [ts(3, 11, 40), 'Thursday works for me! Same time?', true],
    [ts(3, 11, 30), 'Yes, 7pm at my place. We\'re doing chapters 18–24', false],
    [ts(3, 11, 20), 'I still need to catch up on 15-17 😅', true],
    [ts(3, 11, 10), 'Ha! You better get reading. It gets SO good', false],
  ]),

  // 7. David (hiking trip)
  msg('+14155550107', 'David', 'iMessage', 'david', [
    [ts(4, 20, 0), 'Yosemite weekend still on?', false],
    [ts(4, 19, 40), 'Yes! I booked the campsite 🏕️', true],
    [ts(4, 19, 30), 'Amazing. I\'ll bring the camping stove', false],
    [ts(4, 19, 20), 'I\'ll handle food and water filters', true],
    [ts(4, 19, 10), 'Leave at 6am Friday?', false],
    [ts(4, 19, 0),  'Make it 6:30, I have an early call at 6', true],
    [ts(4, 18, 50), 'Deal. This is going to be epic 🏔️', false],
  ]),

  // 8. Olivia (casual friend)
  msg('+14155550108', 'Olivia', 'iMessage', 'olivia', [
    [ts(1, 3, 0),  'Why did the scarecrow win an award?', false],
    [ts(1, 2, 50), 'Oh no… 😂', true],
    [ts(1, 2, 45), 'Because he was outstanding in his field 😂😂', false],
    [ts(1, 2, 40), 'I hate you so much lmao', true],
    [ts(1, 2, 30), 'Ok ok real question — brunch Sunday?', false],
    [ts(1, 2, 20), 'Obviously yes. That new place on Valencia?', true],
    [ts(1, 2, 10), 'YES. 11am?', false],
    [ts(1, 2, 0),  'Perfect 🥞', true],
  ]),

  // 9. Mike (roommate, bills)
  msg('+14155550109', 'Mike', 'iMessage', 'mike', [
    [ts(5, 2, 0),  'Hey did you Venmo me for utilities yet?', false],
    [ts(5, 1, 50), 'Oh shoot, forgot — sending now', true],
    [ts(5, 1, 40), 'Got it, thanks! Also internet bill went up $15', false],
    [ts(5, 1, 30), 'Ugh okay. I\'ll pay my half this month and we can switch providers', true],
    [ts(5, 1, 20), 'Already looking at options. AT&T has a deal', false],
    [ts(5, 1, 10), 'Let me know what you find 👍', true],
  ]),

  // 10. Lisa (job promotion congrats)
  msg('+14155550110', 'Lisa', 'iMessage', 'lisa', [
    [ts(6, 10, 0), 'WAIT did you just get promoted to Senior PM?!', false],
    [ts(6, 9, 50), 'Hahaha yes!! Found out this morning 🎉', true],
    [ts(6, 9, 40), 'OMG CONGRATS!!! You deserve this so much', false],
    [ts(6, 9, 30), 'Thank you 😭 I\'m still in shock honestly', true],
    [ts(6, 9, 20), 'We need to celebrate! Drinks on me this week', false],
    [ts(6, 9, 10), 'I\'m not going to say no to that 🥂', true],
  ]),

  // 11. Carlos (startup idea)
  msg('+14155550111', 'Carlos', 'iMessage', 'carlos', [
    [ts(7, 16, 0), 'Dude I have an idea and I think it\'s actually good this time', false],
    [ts(7, 15, 40), 'Lol last time you said that it was a Uber for laundry 😂', true],
    [ts(7, 15, 30), 'Okay that one was ahead of its time. This is different', false],
    [ts(7, 15, 20), 'Alright I\'m listening', true],
    [ts(7, 15, 10), 'AI that reads your messages and drafts replies — you just pick the tone', false],
    [ts(7, 15, 0),  'Wait… that is actually kind of cool', true],
    [ts(7, 14, 50), 'I KNOW. Coffee Thursday to talk through it?', false],
    [ts(7, 14, 40), 'Thursday works, text me the place', true],
  ]),

  // 12. Chase Bank Alerts
  msg('+18005551212', 'Chase Bank', 'SMS', 'chase', [
    [ts(0, 6, 0),  'CHASE ALERT: A purchase of $84.50 was made at Whole Foods. If you didn\'t make this, call 1-800-935-9935.', false],
    [ts(0, 5, 55), 'That was me, thanks', true],
    [ts(2, 0, 30), 'CHASE ALERT: Your statement is ready. Balance: $3,241.88. Min payment: $35 due Jun 1.', false],
  ]),

  // 13. Airbnb
  msg('+18885552534', 'Airbnb', 'SMS', 'airbnb', [
    [ts(8, 14, 0), 'Your reservation in Portland is confirmed! Check-in: May 15 at 3pm. Host: Maria. PIN: 4821. Have a great trip!', false],
    [ts(8, 13, 50), 'Thank you!', true],
  ]),

  // 14. Priya (colleague, project)
  msg('+14155550114', 'Priya', 'iMessage', 'priya', [
    [ts(2, 8, 0),  'The API is failing in staging. Can you take a look?', false],
    [ts(2, 7, 45), 'On it — what\'s the error?', true],
    [ts(2, 7, 30), '503 on the auth endpoint. Started about an hour ago', false],
    [ts(2, 7, 20), 'Found it — rate limiter config got pushed wrong. Rolling back now', true],
    [ts(2, 7, 10), 'Okay staging looks green again', true],
    [ts(2, 7, 0),  'You\'re amazing. That was fast 🙏', false],
    [ts(2, 6, 50), 'All good, happens! Adding a better alert for this', true],
  ]),

  // 15. Group chat — Weekend BBQ
  msg('chat-bbq-group-01', 'Weekend BBQ 🔥', 'iMessage', 'bbq', [
    [ts(3, 14, 0), 'Who\'s bringing the grill?', false, '+14155550103'],
    [ts(3, 13, 50), 'I have a portable one, I got it', true],
    [ts(3, 13, 40), 'I\'ll bring drinks and snacks 🍺', false, '+14155550105'],
    [ts(3, 13, 30), 'Veggie burgers for me please 🥦', false, '+14155550108'],
    [ts(3, 13, 20), 'On the list! What time works for everyone?', true],
    [ts(3, 13, 10), '4pm?', false, '+14155550103'],
    [ts(3, 13, 0),  '4pm works', false, '+14155550105'],
    [ts(3, 12, 50), '4pm is great!', false, '+14155550108'],
    [ts(3, 12, 40), 'Perfect — my place, this Saturday. See y\'all then 🔥', true],
  ]),
];

let total = 0;
for (const batch of conversations) {
  const accepted = db.syncMessages(userId, batch);
  total += accepted;
}

console.log(`Seeded ${total} messages across ${conversations.length} conversations.\n`);
console.log(`──────────────────────────────`);
console.log(`  Demo credentials`);
console.log(`  Username: ${DEMO_USERNAME}`);
console.log(`  Password: ${DEMO_PASSWORD}`);
console.log(`──────────────────────────────\n`);
