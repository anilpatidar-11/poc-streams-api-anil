// database/migrations/001_create_users_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  /**
   * ══════════════════════════════════════════════════════════════
   * CREATE USERS TABLE
   * ══════════════════════════════════════════════════════════════
   * 
   * This table stores all registered users for authentication
   * 
   * Run migration:
   *   node ace migration:run
   * 
   * Rollback (delete table):
   *   node ace migration:rollback
   */
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      // ── PRIMARY KEY ─────────────────────────────────────────
      /**
       * Auto-incrementing ID
       * Example: 1, 2, 3, 4...
       */
      table.increments('id').notNullable()

      // ── USER INFO ───────────────────────────────────────────
      /**
       * Full Name (optional)
       * Example: "John Doe", "Alice Smith"
       * Nullable because some users might only have email
       */
      table.string('full_name').nullable()

      /**
       * Email Address (required, unique)
       * - Used for login
       * - Must be unique (no duplicate emails)
       * - Max 254 characters (RFC 5321 standard)
       * Example: "user@example.com"
       */
      table.string('email', 254).notNullable().unique()

      /**
       * Password Hash (required)
       * - Never stores plain password
       * - Auto-hashed by Lucid using scrypt
       * - Example hash: "$scrypt$n=16384,r=8,p=1$..."
       */
      table.string('password').notNullable()

      // ── TIMESTAMPS ──────────────────────────────────────────
      /**
       * Created At
       * - Automatically set when user is created
       * - Example: "2025-02-12T10:30:00.000Z"
       */
      table.timestamp('created_at').notNullable()

      /**
       * Updated At
       * - Automatically updated on every save
       * - Nullable (null on first create, then gets timestamp)
       */
      table.timestamp('updated_at').nullable()
    })
  }

  /**
   * ══════════════════════════════════════════════════════════════
   * ROLLBACK (DELETE TABLE)
   * ══════════════════════════════════════════════════════════════
   * 
   * This runs when you execute:
   *   node ace migration:rollback
   */
  async down() {
    this.schema.dropTable(this.tableName)
  }
}

/**
 * ══════════════════════════════════════════════════════════════
 * EXAMPLE DATA IN TABLE
 * ══════════════════════════════════════════════════════════════
 * 
 * ┌────┬───────────────┬─────────────────────┬──────────────────────────┬─────────────────────────┬─────────────────────────┐
 * │ id │ full_name     │ email               │ password                 │ created_at              │ updated_at              │
 * ├────┼───────────────┼─────────────────────┼──────────────────────────┼─────────────────────────┼─────────────────────────┤
 * │ 1  │ Test User     │ test@puc.com        │ $scrypt$n=16384,r=8,... │ 2025-02-12 10:30:00.000 │ 2025-02-12 10:30:00.000 │
 * │ 2  │ John Doe      │ john@example.com    │ $scrypt$n=16384,r=8,... │ 2025-02-12 11:00:00.000 │ 2025-02-12 11:00:00.000 │
 * │ 3  │ Alice Smith   │ alice@company.com   │ $scrypt$n=16384,r=8,... │ 2025-02-12 12:15:00.000 │ 2025-02-12 12:15:00.000 │
 * └────┴───────────────┴─────────────────────┴──────────────────────────┴─────────────────────────┴─────────────────────────┘
 * 
 * NOTE: Password is NEVER stored in plain text!
 */