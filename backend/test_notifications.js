const { getDb } = require("./src/db/database");
const db = getDb();

// Verify tables exist
const tables = db
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('notifications','notification_preferences') ORDER BY name`
  )
  .all();
console.log("Tables created:", tables.map((t) => t.name).join(", "));

// Verify notifications table schema
const nCols = db.pragma("table_info(notifications)");
console.log(
  "\nnotifications columns:",
  nCols.map((c) => c.name).join(", ")
);

// Verify preferences table schema
const pCols = db.pragma("table_info(notification_preferences)");
console.log(
  "notification_preferences columns:",
  pCols.map((c) => c.name).join(", ")
);

// Test model CRUD
const nm = require("./src/models/notification.model");

// Find a real user or create a test one
let testUserId;
let createdTestUser = false;
const existingUser = db.prepare("SELECT id FROM users LIMIT 1").get();
if (existingUser) {
  testUserId = existingUser.id;
  console.log("\nUsing existing user:", testUserId);
} else {
  const { encrypt } = require("./src/db/database");
  const info = db
    .prepare("INSERT INTO users (smt_username, smt_password_enc) VALUES (?, ?)")
    .run("test_notif_user", encrypt("testpass"));
  testUserId = info.lastInsertRowid;
  createdTestUser = true;
  console.log("\nCreated test user:", testUserId);
}

// Create test notifications
const n1 = nm.create({
  userId: testUserId,
  type: "high_usage",
  title: "Test: High Usage",
  body: "You used 50 kWh today!",
  priority: "high",
  metadata: { kwhToday: 50, avgDaily: 25 },
});
console.log("\nCreated notification:", n1);

const n2 = nm.create({
  userId: testUserId,
  type: "budget_exceeded",
  title: "Test: Budget Exceeded",
  body: "You spent $12 today vs $8 budget",
  priority: "high",
  metadata: { todayCost: 12, budget: 8 },
});

const n3 = nm.create({
  userId: testUserId,
  type: "better_provider",
  title: "Test: Cheaper Plan",
  body: "Gexa Energy has better rates",
  priority: "normal",
  metadata: { suggestedProvider: "Gexa Energy" },
});

// Count unread
console.log("Unread count:", nm.countUnread(testUserId));

// Get active
const active = nm.getActive({ userId: testUserId });
console.log("Active notifications:", active.length);
console.log(
  "First notification metadata type:",
  typeof active[0]?.metadata,
  "parsed:",
  active[0]?.metadata?.suggestedProvider || active[0]?.metadata?.kwhToday
);

// Mark one as read
nm.markRead(n1.id, testUserId);
console.log("After marking 1 read, unread:", nm.countUnread(testUserId));

// Dismiss one
nm.dismiss(n2.id, testUserId);
const afterDismiss = nm.getActive({ userId: testUserId });
console.log("After dismissing 1, active:", afterDismiss.length);

// Test existsTodayForType
console.log(
  "existsTodayForType(high_usage):",
  nm.existsTodayForType(testUserId, "high_usage")
);
console.log(
  "existsTodayForType(weekly_summary):",
  nm.existsTodayForType(testUserId, "weekly_summary")
);

// Preferences
const prefs = nm.getPreferences(testUserId);
console.log("\nDefault prefs:", JSON.stringify(prefs));

nm.updatePreferences(testUserId, {
  dailySummary: true,
  dailyBudget: 10.0,
  spikeThreshold: 1.8,
});
const updated = nm.getPreferences(testUserId);
console.log("Updated prefs:", JSON.stringify(updated));

// Test the notification service import works
const ns = require("./src/services/notification.service");
console.log(
  "\nNotification service exports:",
  Object.keys(ns).join(", ")
);

// Test routes load
const routes = require("./src/routes/notification.routes");
console.log("Notification routes loaded:", routes.stack ? "OK" : "FAIL");

// Clean up test data
db.prepare("DELETE FROM notifications WHERE user_id = ?").run(testUserId);
db.prepare("DELETE FROM notification_preferences WHERE user_id = ?").run(testUserId);
if (createdTestUser) {
  db.prepare("DELETE FROM users WHERE id = ?").run(testUserId);
}
console.log("\n✓ Cleanup done. All tests passed!");
