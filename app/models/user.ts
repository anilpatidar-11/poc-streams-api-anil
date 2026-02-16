// app/models/user.ts
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Video from '#models/video'

// ══════════════════════════════════════════════════════════════
// Auth Mixin — Handles password hashing & verification
// ══════════════════════════════════════════════════════════════
const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],              // Login using email
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  
  // ── PRIMARY KEY ─────────────────────────────────────────────
  @column({ isPrimary: true })
  declare id: number

  // ── USER INFO ───────────────────────────────────────────────
  @column()
  declare fullName: string | null

  @column()
  declare email: string

  /**
   * Password is auto-hashed when saving to database
   * serializeAs: null → never expose in API responses
   */
  @column({ serializeAs: null })
  declare password: string

  // ── TIMESTAMPS ──────────────────────────────────────────────
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── RELATIONSHIPS ───────────────────────────────────────────
  /**
   * One user has many videos
   * Usage: await user.load('videos')
   *        user.videos → array of Video models
   */
  @hasMany(() => Video)
  declare videos: HasMany<typeof Video>

  // ── AUTH TOKENS PROVIDER ────────────────────────────────────
  /**
   * Manages API access tokens (stored in auth_access_tokens table)
   * Usage: 
   *   const token = await User.accessTokens.create(user)
   *   await User.accessTokens.delete(user, tokenId)
   */
  static accessTokens = DbAccessTokensProvider.forModel(User)
}