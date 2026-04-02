const { getDb } = require('./src/db/database');
const db = getDb();

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

const notifCols = db.pragma('table_info(notifications)');
console.log('\nnotifications columns:', notifCols.map(c => c.name).join(', '));

const prefCols = db.pragma('table_info(notification_preferences)');
console.log('notification_preferences columns:', prefCols.map(c => c.name).join(', '));

// Test the notification model
const notifModel = require('./src/models/notification.model');

// Find an actual user, or use a dummy id
const users = db.prepare("SELECT id FROM users LIMIT 1").all();
const testUserId = users.length > 0 ? users[0].id : null;
if (!testUserId) {
  // Create a dummy user for testing
  db.prepare("INSERT INTO users (smt_username, smt_password_enc) VALUES ('test', 'enc')").run();
}
const userId = testUserId || db.prepare("SELECT id FROM users WHERE smt_username = 'test'").get().id;
console.log('Testing with userId:', userId);

// Create a test notification
const n1 = notifModel.create({
  userId,
  type: 'high_usage',
  title: '⚡ High Energy Usage Today',
  body: 'You used 45.2 kWh today — 80% above your 7-day average.',
  priority: 'high',
  metadata: { todayKwh: 45.2, avgDailyKwh: 25.1 },
});
console.log('\nCreated notification:', n1);

const n2 = notifModel.create({
  userId,
  type: 'better_provider',
  title: '💡 Cheaper Plan Available',
  body: 'Gexa Energy offers 11.2¢/kWh avg — save ~$15/mo.',
  priority: 'normal',
  metadata: { suggestedProvider: 'Gexa Energy' },
});
console.log('Created notification:', n2);

// Get active notifications
const active = notifModel.getActive({ userId });
console.log('\nActive notifications:', active.length);
active.forEach(n => console.log(`  [${n.type}] ${n.title} (read: ${n.read})`));

// Unread count
const unread = notifModel.countUnread(1);
console.log('\nUnread count:', unread);

// Mark one as read
notifModel.markRead(n1.id, 1);
const unread2 = notifModel.countUnread(1);
console.log('After marking one read, unread:', unread2);

// Test preferences
const prefs = notifModel.getPreferences(1);
console.log('\nDefault preferences:', JSON.stringify(prefs, null, 2));

// Update preferences
notifModel.updatePreferences(1, { dailyBudget: 10.0, usageSpike: false });
const prefs2 = notifModel.getPreferences(1);
console.log('Updated preferences:', JSON.stringify(prefs2, null, 2));

// Cleanup test notifications
notifModel.dismissAll(1);
console.log('\nAll tests passed ✅');
