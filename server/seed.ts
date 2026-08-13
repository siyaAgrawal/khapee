import fs from 'node:fs'
import path from 'node:path'
import { db, UPLOAD_DIR } from './db.ts'
import { hashPassword } from './auth.ts'
import { tableToken } from './ids.ts'

type SeedItem = [name: string, description: string, price: number, emoji: string, hue: number, veg?: boolean]

type SeedRestaurant = {
  slug: string
  name: string
  description: string
  address: string
  categories: string
  emoji: string
  hue: number
  isOpen: boolean
  hours: string
  prep: number
  rating: number
  tables: number
  staff: { name: string; email: string; title: string }
  menu: { category: string; items: SeedItem[] }[]
}

/**
 * Demo data only — these are invented businesses used to exercise the app.
 * Replace them with your own restaurants via the dashboard, the "list your
 * restaurant" sign-up, or `npm run import`.
 */
const RESTAURANTS: SeedRestaurant[] = [
  {
    slug: 'mornington',
    name: 'Mornington Coffee House',
    description: 'Slow-roasted single origin, warm pastries and a very good cold coffee.',
    address: 'Scheme 54, Vijay Nagar, Indore',
    categories: 'Cafe, Coffee, Bakery',
    emoji: '☕',
    hue: 28,
    isOpen: true,
    hours: '7:00 AM – 10:00 PM',
    prep: 12,
    rating: 4.7,
    tables: 6,
    staff: { name: 'Riya Menon', email: 'staff@mornington.test', title: 'Floor Manager' },
    menu: [
      {
        category: 'Coffee',
        items: [
          ['Cold Coffee', 'Double shot, milk, ice, blended till frothy', 220, '🥤', 28],
          ['Flat White', 'Ristretto base with silky microfoam', 260, '☕', 24],
          ['Filter Kaapi', 'South Indian filter decoction, frothed', 180, '🍵', 32],
          ['Iced Americano', 'Long black over ice with an orange twist', 210, '🧊', 20],
        ],
      },
      {
        category: 'Bakery',
        items: [
          ['Butter Croissant', 'Laminated overnight, baked each morning', 190, '🥐', 40],
          ['Almond Danish', 'Frangipane, toasted flakes, icing sugar', 240, '🥧', 44],
          ['Banana Walnut Loaf', 'Thick slice, lightly warmed', 200, '🍰', 36],
        ],
      },
      {
        category: 'All Day Plates',
        items: [
          ['Truffle Mushroom Toast', 'Sourdough, garlic cream, chives', 380, '🍄', 18],
          ['Big Breakfast', 'Eggs your way, hash, greens, toast', 460, '🍳', 46],
          ['Chicken Pesto Sandwich', 'Grilled chicken, basil pesto, focaccia', 420, '🥪', 100, false],
        ],
      },
    ],
  },
  {
    slug: 'basil-and-bay',
    name: 'Basil & Bay',
    description: 'Handmade pasta, wood-fired pizza and a short, seasonal wine list.',
    address: 'AB Road, South Tukoganj, Indore',
    categories: 'Italian, Pasta, Pizza',
    emoji: '🍝',
    hue: 350,
    isOpen: true,
    hours: '12:00 PM – 11:30 PM',
    prep: 22,
    rating: 4.6,
    tables: 8,
    staff: { name: 'Dev Kapoor', email: 'staff@basilandbay.test', title: 'Head Waiter' },
    menu: [
      {
        category: 'Starters',
        items: [
          ['Garlic Focaccia', 'Rosemary, sea salt, olive oil dip', 260, '🫓', 44],
          ['Burrata & Peach', 'Creamy burrata, grilled peach, basil oil', 540, '🧀', 50],
          ['Crispy Calamari', 'Lemon aioli, fried capers', 480, '🦑', 200, false],
        ],
      },
      {
        category: 'Pasta',
        items: [
          ['Pasta Alfredo', 'Fettuccine, parmesan cream, black pepper', 520, '🍝', 45],
          ['Arrabbiata Penne', 'Slow tomato, chilli, garlic, parsley', 470, '🌶️', 8],
          ['Truffle Ravioli', 'Ricotta filling, brown butter, sage', 640, '🥟', 30],
          ['Prawn Aglio Olio', 'Spaghetti, chilli, garlic, tiger prawns', 690, '🍤', 12, false],
        ],
      },
      {
        category: 'Wood-Fired Pizza',
        items: [
          ['Margherita', 'San Marzano, fior di latte, basil', 480, '🍕', 355],
          ['Diavola', 'Spicy salami, chilli honey, mozzarella', 620, '🔥', 5, false],
          ['Quattro Formaggi', 'Four cheese, walnut, hot honey', 660, '🧀', 42],
        ],
      },
      {
        category: 'Dessert',
        items: [
          ['Tiramisu', 'Espresso soak, mascarpone, cocoa', 340, '🍮', 26],
          ['Lemon Panna Cotta', 'Set cream, citrus curd, pistachio', 320, '🍋', 52],
        ],
      },
    ],
  },
  {
    slug: 'the-tandoor-room',
    name: 'The Tandoor Room',
    description: 'Charcoal grills, hand-rolled breads and North Indian classics.',
    address: 'MG Road, New Palasia, Indore',
    categories: 'North Indian, Grill, Biryani',
    emoji: '🍛',
    hue: 14,
    isOpen: true,
    hours: '11:00 AM – 12:00 AM',
    prep: 25,
    rating: 4.5,
    tables: 10,
    staff: { name: 'Aarav Shah', email: 'staff@tandoorroom.test', title: 'Shift Lead' },
    menu: [
      {
        category: 'From the Tandoor',
        items: [
          ['Paneer Tikka', 'Hung curd marinade, capsicum, onion', 420, '🧀', 30],
          ['Murgh Malai Tikka', 'Cream cheese and cardamom marinade', 520, '🍢', 40, false],
          ['Tandoori Broccoli', 'Almond marinade, smoked chilli', 400, '🥦', 110],
        ],
      },
      {
        category: 'Mains',
        items: [
          ['Dal Makhani', 'Twelve hours on low charcoal heat', 380, '🍲', 24],
          ['Butter Chicken', 'Tomato, cashew, fenugreek, cream', 560, '🍗', 10, false],
          ['Kadhai Paneer', 'Fresh ground kadhai masala, peppers', 470, '🫕', 18],
          ['Hyderabadi Biryani', 'Sealed dum, saffron, mint raita', 590, '🍚', 36, false],
        ],
      },
      {
        category: 'Breads & Rice',
        items: [
          ['Butter Naan', 'Tandoor baked, brushed with butter', 90, '🫓', 44],
          ['Laccha Paratha', 'Layered whole wheat, flaky', 110, '🥙', 40],
          ['Jeera Rice', 'Basmati tempered with cumin', 220, '🍚', 48],
        ],
      },
    ],
  },
  {
    slug: 'sakura-bowl',
    name: 'Sakura Bowl',
    description: 'Ramen, donburi and hand rolls. Opens at five, closed for lunch prep.',
    address: 'Race Course Road, Indore',
    categories: 'Japanese, Ramen, Sushi',
    emoji: '🍜',
    hue: 330,
    isOpen: false,
    hours: '5:00 PM – 11:00 PM',
    prep: 18,
    rating: 4.8,
    tables: 5,
    staff: { name: 'Mei Tanaka', email: 'staff@sakurabowl.test', title: 'Manager' },
    menu: [
      {
        category: 'Ramen',
        items: [
          ['Shoyu Ramen', 'Soy tare, chicken broth, ajitama', 620, '🍜', 30, false],
          ['Miso Corn Butter', 'Rich miso broth, sweetcorn, butter', 580, '🌽', 48],
        ],
      },
      {
        category: 'Bowls',
        items: [
          ['Chicken Katsu Don', 'Panko cutlet, egg, sweet onion', 640, '🍱', 20, false],
          ['Veg Tempura Bowl', 'Seasonal vegetables, tentsuyu', 540, '🍤', 40],
        ],
      },
    ],
  },
  {
    slug: 'malwa-chai-and-poha',
    name: 'Malwa Chai & Poha',
    description: 'Breakfast counter for indori poha, hot jalebi and cutting chai.',
    address: 'Sudama Nagar, Indore',
    categories: 'Breakfast, Street Food, Chai',
    emoji: '🍛',
    hue: 46,
    isOpen: true,
    hours: '6:30 AM – 1:00 PM',
    prep: 8,
    rating: 4.6,
    tables: 4,
    staff: { name: 'Pooja Verma', email: 'staff@malwachai.test', title: 'Owner' },
    menu: [
      {
        category: 'Breakfast',
        items: [
          ['Indori Poha', 'Steamed poha, sev, onion, jeeravan masala', 40, '🍛', 46],
          ['Poha Jalebi', 'A plate of poha with two hot jalebis', 70, '🥮', 38],
          ['Sabudana Khichdi', 'Peanut, curry leaf, green chilli, lemon', 60, '🍚', 50],
          ['Usal Poha', 'Poha topped with spiced white peas', 60, '🥘', 30],
        ],
      },
      {
        category: 'Snacks',
        items: [
          ['Khasta Kachori', 'Crisp shell, spiced dal filling, chutney', 35, '🥟', 34],
          ['Samosa', 'Potato and pea filling, fried to order', 25, '🔺', 40],
          ['Garadu Chaat', 'Fried yam, jeeravan, lemon (winter special)', 80, '🍠', 28],
        ],
      },
      {
        category: 'Chai & Cold',
        items: [
          ['Cutting Chai', 'Strong, milky, boiled with ginger', 20, '☕', 26],
          ['Masala Chai', 'Cardamom, clove, black pepper', 30, '🍵', 32],
          ['Shikanji', 'Lemon, black salt, roasted cumin', 45, '🥤', 60],
        ],
      },
    ],
  },
]

const CUSTOMERS = [
  { name: 'Siya Agrawal', email: 'siya@tablo.test' },
  { name: 'Nikhil Rao', email: 'nikhil@tablo.test' },
]

export const DEMO_PASSWORD = 'password123'

function seedNow() {
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
  )
  const hash = hashPassword(DEMO_PASSWORD)

  for (const c of CUSTOMERS) insertUser.run(c.name, c.email, hash, 'customer')

  for (const r of RESTAURANTS) {
    const info = db
      .prepare(
        `INSERT INTO restaurants (slug, name, description, address, categories, emoji, hue, is_open, hours, prep_minutes, rating)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.slug,
        r.name,
        r.description,
        r.address,
        r.categories,
        r.emoji,
        r.hue,
        r.isOpen ? 1 : 0,
        r.hours,
        r.prep,
        r.rating,
      )
    const restaurantId = Number(info.lastInsertRowid)

    const staffInfo = insertUser.run(r.staff.name, r.staff.email, hash, 'staff')
    db.prepare('INSERT INTO restaurant_staff (user_id, restaurant_id, job_title) VALUES (?, ?, ?)').run(
      Number(staffInfo.lastInsertRowid),
      restaurantId,
      r.staff.title,
    )

    r.menu.forEach((cat, ci) => {
      const catInfo = db
        .prepare('INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES (?, ?, ?)')
        .run(restaurantId, cat.category, ci)
      const categoryId = Number(catInfo.lastInsertRowid)
      cat.items.forEach((item, ii) => {
        const [name, description, price, emoji, hue, veg = true] = item
        db.prepare(
          `INSERT INTO menu_items (restaurant_id, category_id, name, description, price_cents, emoji, hue, is_veg, is_available, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        ).run(restaurantId, categoryId, name, description, price * 100, emoji, hue, veg ? 1 : 0, ci * 100 + ii)
      })
    })

    for (let t = 1; t <= r.tables; t++) {
      db.prepare('INSERT INTO restaurant_tables (restaurant_id, label, seats, token) VALUES (?, ?, ?, ?)').run(
        restaurantId,
        `Table ${t}`,
        t % 3 === 0 ? 6 : t % 2 === 0 ? 2 : 4,
        tableToken(),
      )
    }
  }

  // One sold-out item so the "unavailable" state is visible immediately.
  db.prepare(
    `UPDATE menu_items SET is_available = 0
     WHERE name = 'Almond Danish' AND restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mornington')`,
  ).run()
}

/** Seeds on first boot only; safe to call on every start. */
export function ensureSeed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM restaurants').get() as any
  if (count.n > 0) return false
  db.transaction(seedNow)()
  console.log('  ✓ seeded demo restaurants, menus, tables and accounts')
  return true
}

function reset() {
  // Uploaded photos belong to the rows we are about to delete.
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, file))
    } catch {
      /* leave it */
    }
  }
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM order_events; DELETE FROM order_items; DELETE FROM notifications;
    DELETE FROM orders; DELETE FROM access_codes; DELETE FROM restaurant_tables;
    DELETE FROM menu_items; DELETE FROM menu_categories; DELETE FROM restaurant_staff;
    DELETE FROM restaurants; DELETE FROM sessions; DELETE FROM users;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `)
  db.transaction(seedNow)()
  console.log('  ✓ database reset and reseeded')
}

if (process.argv.includes('--force')) reset()
