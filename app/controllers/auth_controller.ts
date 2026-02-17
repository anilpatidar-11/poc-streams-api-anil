import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth_validator'
import ResponseHelper from '../utils/response_helper.js'

export default class AuthController {
  async register({ request, response, i18n }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      const existing = await User.findBy('email', data.email)
      if (existing) {
        return ResponseHelper.badRequest(response, i18n.t('auth.email_already_registered'))
      }

      const user = await User.create({
        fullName: data.full_name,
        email: data.email,
        password: data.password,
      })

      return ResponseHelper.created(response, i18n.t('auth.registration_success'), {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      })
    } catch (error) {
      return ResponseHelper.serverError(response, i18n.t('general.something_went_wrong'), error)
    }
  }

  async login({ request, response, i18n }: HttpContext) {
    try {
      const { email, password } = await request.validateUsing(loginValidator)

      const user = await User.verifyCredentials(email, password)

      const token = await User.accessTokens.create(user, ['*'], {
        name: 'api_token',
        expiresIn: '30 days',
      })

      return ResponseHelper.success(response, i18n.t('auth.login_success'), {
        token: token.value!.release(),
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
      })
    } catch (error) {
      return ResponseHelper.unauthorized(response, i18n.t('auth.invalid_credentials'), error)
    }
  }

  async logout({ auth, response, i18n }: HttpContext) {
    try {
      const user = await auth.authenticate()
      await User.accessTokens.delete(user, user.currentAccessToken.identifier)

      return ResponseHelper.success(response, i18n.t('auth.logout_success'))
    } catch (error) {
      return ResponseHelper.unauthorized(response, i18n.t('auth.unauthorized'), error)
    }
  }

  async me({ auth, response, i18n }: HttpContext) {
    try {
      const user = await auth.authenticate()

      return ResponseHelper.success(response, i18n.t('auth.login_success'), {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        createdAt: user.createdAt,
      })
    } catch (error) {
      return ResponseHelper.unauthorized(response, i18n.t('auth.unauthorized'), error)
    }
  }
}
