import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })

/**
 * Serverless hosts (Vercel) give a read-only filesystem with only /tmp
 * writable, and that /tmp does not survive a cold start. So there we run on a
 * copy of the committed snapshot: the whole catalogue is browsable and the app
 * fully works, but anything written is scoped to that instance's lifetime.
 * A host with a real disk (see DEPLOY.md) keeps everything permanently.
 */
const SERVERLESS = !!process.env.VERCEL
const SNAPSHOT = path.join(dataDir, 'snapshot.db')

function resolveDbPath(): string {
  if (process.env.TABLO_DB) return path.resolve(process.env.TABLO_DB)
  if (!SERVERLESS) return path.join(dataDir, 'tablo.db')

  const ephemeral = '/tmp/tablo.db'
  if (!fs.existsSync(ephemeral) && fs.existsSync(SNAPSHOT)) {
    fs.copyFileSync(SNAPSHOT, ephemeral)
  }
  return ephemeral
}

export const DB_PATH = resolveDbPath()
export const IS_EPHEMERAL = SERVERLESS && !process.env.TABLO_DB

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('customer','staff')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  address      TEXT    NOT NULL DEFAULT '',
  categories   TEXT    NOT NULL DEFAULT '',
  emoji        TEXT    NOT NULL DEFAULT '🍽️',
  hue          INTEGER NOT NULL DEFAULT 210,
  is_open      INTEGER NOT NULL DEFAULT 1,
  hours        TEXT    NOT NULL DEFAULT '9:00 AM – 11:00 PM',
  prep_minutes INTEGER NOT NULL DEFAULT 15,
  rating       REAL    NOT NULL DEFAULT 4.5,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurant_staff (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  job_title     TEXT    NOT NULL DEFAULT 'Staff',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  price_cents   INTEGER NOT NULL,
  emoji         TEXT    NOT NULL DEFAULT '🍽️',
  hue           INTEGER NOT NULL DEFAULT 24,
  is_veg        INTEGER NOT NULL DEFAULT 1,
  is_available  INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  seats         INTEGER NOT NULL DEFAULT 4,
  token         TEXT    NOT NULL UNIQUE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (restaurant_id, label)
);

CREATE TABLE IF NOT EXISTS access_codes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code           TEXT    NOT NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT    NOT NULL,
  single_use     INTEGER NOT NULL DEFAULT 1,
  used_at        TEXT,
  used_by_order  INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  revoked_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_codes_code ON access_codes(code);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number    TEXT    NOT NULL UNIQUE,
  restaurant_id   INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name   TEXT    NOT NULL,
  order_type      TEXT    NOT NULL CHECK (order_type IN ('dine_in','pickup')),
  table_id        INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  table_label     TEXT,
  status          TEXT    NOT NULL DEFAULT 'NEW',
  payment_status  TEXT    NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID')),
  payment_method  TEXT    NOT NULL DEFAULT 'counter',
  total_cents     INTEGER NOT NULL DEFAULT 0,
  note            TEXT    NOT NULL DEFAULT '',
  verify_token    TEXT    NOT NULL,
  access_code_id  INTEGER REFERENCES access_codes(id) ON DELETE SET NULL,
  verified_at     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  name          TEXT    NOT NULL,
  emoji         TEXT    NOT NULL DEFAULT '🍽️',
  unit_price_cents INTEGER NOT NULL,
  quantity      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  actor      TEXT    NOT NULL DEFAULT 'system',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  order_id      INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  read_at       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);
`)

/** Additive migrations so an existing database picks up new columns on boot. */
function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

addColumn('restaurants', 'image_path', 'TEXT')
addColumn('restaurants', 'phone', "TEXT NOT NULL DEFAULT ''")
addColumn('menu_items', 'image_path', 'TEXT')

// Service options each restaurant chooses to offer.
addColumn('restaurants', 'accepts_pickup', 'INTEGER NOT NULL DEFAULT 1')
addColumn('restaurants', 'accepts_takeaway', 'INTEGER NOT NULL DEFAULT 1')
addColumn('restaurants', 'accepts_groups', 'INTEGER NOT NULL DEFAULT 1')

// UPI collection details. Payment is a direct customer → restaurant UPI
// transfer; this app never touches the money, it only shows the request.
addColumn('restaurants', 'upi_vpa', "TEXT NOT NULL DEFAULT ''")
addColumn('restaurants', 'upi_name', "TEXT NOT NULL DEFAULT ''")

// Where the restaurant is, for "near me" sorting. Filled in by the restaurant.
addColumn('restaurants', 'city', "TEXT NOT NULL DEFAULT ''")
addColumn('restaurants', 'lat', 'REAL')
addColumn('restaurants', 'lng', 'REAL')

// A dine-in order the customer is carrying out rather than eating at a table.
addColumn('orders', 'takeaway', 'INTEGER NOT NULL DEFAULT 0')
addColumn('orders', 'group_session_id', 'INTEGER')
addColumn('order_items', 'member_id', 'INTEGER')
addColumn('order_items', 'paid_at', 'TEXT')

// One account can both order as a customer and run restaurants, so the
// dashboard needs to know which of their restaurants is currently in view.
addColumn('users', 'active_restaurant_id', 'INTEGER')

db.exec(`
CREATE TABLE IF NOT EXISTS dining_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT    NOT NULL UNIQUE,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id       INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  table_label    TEXT,
  access_code_id INTEGER REFERENCES access_codes(id) ON DELETE SET NULL,
  source         TEXT    NOT NULL DEFAULT 'code' CHECK (source IN ('code','table_qr','payment')),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT    NOT NULL,
  closed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_dining_sessions_restaurant ON dining_sessions(restaurant_id);

CREATE TABLE IF NOT EXISTS group_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id      INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  table_label   TEXT,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT
);

CREATE TABLE IF NOT EXISTS group_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT    NOT NULL,
  token        TEXT    NOT NULL UNIQUE,
  is_host      INTEGER NOT NULL DEFAULT 0,
  joined_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_group_members_session ON group_members(session_id);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  session_id    INTEGER REFERENCES group_sessions(id) ON DELETE SET NULL,
  member_id     INTEGER REFERENCES group_members(id) ON DELETE SET NULL,
  payer_name    TEXT    NOT NULL DEFAULT '',
  amount_cents  INTEGER NOT NULL,
  method        TEXT    NOT NULL DEFAULT 'upi',
  status        TEXT    NOT NULL DEFAULT 'CLAIMED' CHECK (status IN ('CLAIMED','CONFIRMED','REJECTED')),
  upi_ref       TEXT    NOT NULL DEFAULT '',
  covers        TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  settled_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, status);
`)

export const UPLOAD_DIR = SERVERLESS ? '/tmp/uploads' : path.join(path.dirname(DB_PATH), 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

export type Row = Record<string, any>
