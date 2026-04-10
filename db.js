const fs = require("fs");
const path = require("path");

const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dataDirectory = path.join(__dirname, "..", "data");
const databasePath = path.join(dataDirectory, "task-manager.db");

fs.mkdirSync(dataDirectory, { recursive: true });

const existingBuffer = fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0
  ? fs.readFileSync(databasePath)
  : null;
const db = existingBuffer ? new Database(existingBuffer) : new Database(":memory:");

db.pragma("foreign_keys = ON");

const now = () => new Date().toISOString();

function persistDatabase() {
  fs.writeFileSync(databasePath, db.serialize());
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
      status TEXT NOT NULL CHECK (status IN ('To Do', 'In Progress', 'Done')),
      due_date TEXT NOT NULL,
      assigned_to INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const timestamp = now();
  const seedDepartment = db.prepare(`
    INSERT OR IGNORE INTO departments (name, description, created_at, updated_at)
    VALUES (@name, @description, @createdAt, @updatedAt)
  `);

  [
    { name: "Operations", description: "Delivery, operations, and support workstreams." },
    { name: "Engineering", description: "Product, engineering, and technical execution." },
    { name: "Finance", description: "Budgeting, approvals, and commercial oversight." },
    { name: "People", description: "Hiring, onboarding, and employee experience." },
  ].forEach((department) => {
    seedDepartment.run({
      name: department.name,
      description: department.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  const adminExists = db
    .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
    .get("admin");

  if (!adminExists) {
    const adminDepartment = db
      .prepare("SELECT id FROM departments WHERE name = ? LIMIT 1")
      .get("Operations");

    db.prepare(`
      INSERT INTO users (
        full_name,
        username,
        password_hash,
        role,
        department_id,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      "System Administrator",
      "admin",
      bcrypt.hashSync("admin123", 10),
      "admin",
      adminDepartment ? adminDepartment.id : null,
      timestamp,
      timestamp
    );
  }

  persistDatabase();
}

function logActivity({ userId = null, taskId = null, action, details = "" }) {
  db.prepare(`
    INSERT INTO activity_logs (user_id, task_id, action, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, taskId, action, details, now());

  persistDatabase();
}

module.exports = {
  db,
  initDatabase,
  logActivity,
  now,
  persistDatabase,
};
