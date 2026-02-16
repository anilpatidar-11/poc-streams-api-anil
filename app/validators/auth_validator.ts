// app/validators/auth_validator.ts
import vine from '@vinejs/vine'

/**
 * ══════════════════════════════════════════════════════════════
 * REGISTER VALIDATOR
 * ══════════════════════════════════════════════════════════════
 * Validates user registration data
 * 
 * Expected input:
 * {
 *   "full_name": "Test User",
 *   "email": "test@example.com",
 *   "password": "secret123"
 * }
 */
export const registerValidator = vine.compile(
  vine.object({
    /**
     * Full Name
     * - Required
     * - Minimum 2 characters
     * - Maximum 100 characters
     * - Automatically trimmed (removes extra spaces)
     */
    full_name: vine
      .string()
      .trim()
      .minLength(2)
      .maxLength(100),

    /**
     * Email
     * - Required
     * - Must be valid email format
     * - Normalized (lowercase, trimmed)
     * - Example: "Test@Example.COM" → "test@example.com"
     */
    email: vine
      .string()
      .email()
      .normalizeEmail(),

    /**
     * Password
     * - Required
     * - Minimum 6 characters
     * - Maximum 100 characters
     * - No trimming (spaces allowed in password)
     */
    password: vine
      .string()
      .minLength(6)
      .maxLength(100),
  })
)

/**
 * ══════════════════════════════════════════════════════════════
 * LOGIN VALIDATOR
 * ══════════════════════════════════════════════════════════════
 * Validates login credentials
 * 
 * Expected input:
 * {
 *   "email": "test@example.com",
 *   "password": "secret123"
 * }
 */
export const loginValidator = vine.compile(
  vine.object({
    /**
     * Email
     * - Required
     * - Must be valid email format
     * - Normalized
     */
    email: vine
      .string()
      .email()
      .normalizeEmail(),

    /**
     * Password
     * - Required
     * - Minimum 1 character (allow any password for login)
     */
    password: vine
      .string()
      .minLength(1),
  })
)

/**
 * ══════════════════════════════════════════════════════════════
 * USAGE IN CONTROLLER
 * ══════════════════════════════════════════════════════════════
 * 
 * import { registerValidator, loginValidator } from '#validators/auth_validator'
 * 
 * async register({ request }: HttpContext) {
 *   const data = await request.validateUsing(registerValidator)
 *   // data is now validated and typed!
 *   // data.email, data.password, data.full_name
 * }
 * 
 * ══════════════════════════════════════════════════════════════
 * ERROR RESPONSES (Automatic)
 * ══════════════════════════════════════════════════════════════
 * 
 * If validation fails, AdonisJS automatically returns 422:
 * {
 *   "errors": [
 *     {
 *       "field": "email",
 *       "rule": "email",
 *       "message": "The email field must be a valid email"
 *     },
 *     {
 *       "field": "password",
 *       "rule": "minLength",
 *       "message": "The password field must have at least 6 characters"
 *     }
 *   ]
 * }
 */