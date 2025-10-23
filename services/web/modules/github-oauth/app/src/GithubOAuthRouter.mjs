import crypto from 'node:crypto'
import passport from 'passport'
import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.js'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.js'
import ThirdPartyIdentityManager from '../../../../app/src/Features/User/ThirdPartyIdentityManager.js'
import UserCreator from '../../../../app/src/Features/User/UserCreator.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.js'
import {
  ThirdPartyIdentityExistsError,
  ThirdPartyUserNotFoundError,
} from '../../../../app/src/Features/Errors/Errors.js'
import { isStrategyConfigured } from './setupPassport.mjs'

const PROVIDER_ID = 'github'
const STATE_SESSION_KEY = 'githubOAuthState'

function sanitizeRedirectPath(path, fallback) {
  if (typeof path !== 'string') return fallback
  if (!path.startsWith('/')) return fallback
  if (path.startsWith('//')) return fallback
  return path
}

function buildExternalData(profileWrapper) {
  const { profile } = profileWrapper
  const emails = Array.isArray(profile.emails) ? profile.emails : []
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    profileUrl: profile.profileUrl,
    emails: emails
      .filter(email => typeof email?.value === 'string')
      .map(email => ({
        value: email.value,
        verified: Boolean(email.verified || email.primary),
        primary: Boolean(email.primary),
      })),
    avatarUrl: profile.photos?.[0]?.value,
  }
}

function selectPrimaryEmail(profileWrapper) {
  const emails = Array.isArray(profileWrapper.profile.emails)
    ? profileWrapper.profile.emails
    : []
  const preferred =
    emails.find(email => email.primary && email.value) ||
    emails.find(email => email.verified && email.value) ||
    emails.find(email => email.value)
  return preferred?.value || null
}

function deriveNames(profileWrapper) {
  const profile = profileWrapper.profile
  const displayName =
    typeof profile.displayName === 'string' ? profile.displayName.trim() : ''
  if (displayName) {
    const parts = displayName.split(/\s+/)
    const firstName = parts.shift() || profile.username || 'GitHub'
    const lastName = parts.length > 0 ? parts.join(' ') : ''
    return { firstName, lastName }
  }
  const username =
    typeof profile.username === 'string' ? profile.username.trim() : ''
  if (username) {
    return { firstName: username, lastName: '' }
  }
  return { firstName: 'GitHub', lastName: 'User' }
}

function setLinkingErrorAndRedirect(req, res, message, redirectPath) {
  req.session.ssoErrorMessage = message
  const target = sanitizeRedirectPath(redirectPath, '/user/settings')
  res.redirect(target)
}

function ensureStrategy(req, res, next) {
  if (isStrategyConfigured()) {
    return next()
  }
  logger.warn(
    { path: req.path },
    'GitHub OAuth route accessed without configured strategy'
  )
  res.status(503).send('GitHub OAuth is not configured')
}

async function handleFirstTimeLogin(req, profileWrapper, externalData) {
  const email = selectPrimaryEmail(profileWrapper)
  if (!email) {
    logger.warn(
      { provider: PROVIDER_ID, userId: profileWrapper.profile.id },
      'GitHub profile did not include an email address'
    )
    return null
  }

  let user =
    (await UserGetter.promises.getUserByAnyEmail(email, { email: 1 })) || null
  const auditLogBase = {
    initiatorId: undefined,
    ipAddress: req.ip,
  }

  let justCreated = false

  if (!user) {
    const { firstName, lastName } = deriveNames(profileWrapper)
    user = await UserCreator.promises.createNewUser(
      {
        email,
        first_name: firstName,
        last_name: lastName,
      },
      { confirmedAt: new Date() }
    )
    req.session.justRegistered = true
    justCreated = true
  }

  auditLogBase.initiatorId = user._id

  let linkedUser
  try {
    linkedUser = await ThirdPartyIdentityManager.promises.link(
      user._id,
      PROVIDER_ID,
      profileWrapper.profile.id,
      externalData,
      auditLogBase
    )
  } catch (err) {
    if (err instanceof ThirdPartyIdentityExistsError) {
      logger.warn(
        { provider: PROVIDER_ID, userId: user._id },
        'GitHub account is already linked to another user during login'
      )
      throw err
    }
    throw err
  }

  if (!linkedUser) {
    linkedUser = await UserGetter.promises.getUser(user._id)
  }

  if (justCreated) {
    req.session.analyticsId = req.session.analyticsId || user._id
  }

  return linkedUser
}

function registerRoutes(webRouter) {
  AuthenticationController.addEndpointToLoginWhitelist('/auth/github')
  AuthenticationController.addEndpointToLoginWhitelist('/auth/github/callback')

  webRouter.get('/auth/github', ensureStrategy, (req, res, next) => {
    const intent = req.query.intent === 'link' ? 'link' : 'login'
    const redirectParam =
      intent === 'link' ? sanitizeRedirectPath(req.query.redirect, null) : null

    if (intent === 'link' && !SessionManager.isUserLoggedIn(req.session)) {
      setLinkingErrorAndRedirect(
        req,
        res,
        'Please sign in before linking your GitHub account.'
      )
      return
    }

    const state = crypto.randomBytes(16).toString('hex')
    req.session[STATE_SESSION_KEY] = {
      state,
      intent,
      redirect: redirectParam,
    }

    passport.authenticate(PROVIDER_ID, {
      session: false,
      state,
    })(req, res, next)
  })

  webRouter.get(
    '/auth/github/callback',
    ensureStrategy,
    passport.authenticate(PROVIDER_ID, {
      failureRedirect: '/login?oauth=github',
      session: false,
    }),
    async (req, res, next) => {
      try {
        const stateData = req.session[STATE_SESSION_KEY] || null
        delete req.session[STATE_SESSION_KEY]

        if (!stateData || stateData.state !== req.query.state) {
          logger.warn(
            {
              provider: PROVIDER_ID,
              expected: stateData?.state,
              received: req.query.state,
            },
            'GitHub OAuth state mismatch'
          )
          if (stateData?.intent === 'link') {
            setLinkingErrorAndRedirect(
              req,
              res,
              'GitHub authorization failed. Please try again.',
              stateData.redirect
            )
            return
          }
          res.redirect('/login?oauth=github-state')
          return
        }

        const profileWrapper = req.user
        if (!profileWrapper?.profile?.id) {
          throw new Error('GitHub profile missing from authentication result')
        }

        const externalData = buildExternalData(profileWrapper)

        if (stateData.intent === 'link') {
          if (!SessionManager.isUserLoggedIn(req.session)) {
            setLinkingErrorAndRedirect(
              req,
              res,
              'Your session expired. Please sign in and try linking again.',
              stateData.redirect
            )
            return
          }
          const sessionUser = SessionManager.getSessionUser(req.session)
          try {
            await ThirdPartyIdentityManager.promises.link(
              sessionUser._id,
              PROVIDER_ID,
              profileWrapper.profile.id,
              externalData,
              {
                initiatorId: sessionUser._id,
                ipAddress: req.ip,
              }
            )
          } catch (err) {
            if (err instanceof ThirdPartyIdentityExistsError) {
              setLinkingErrorAndRedirect(
                req,
                res,
                'This GitHub account is already linked to a different Overleaf user.',
                stateData.redirect
              )
              return
            }
            throw err
          }
          req.session.projectSyncSuccessMessage =
            'GitHub account linked successfully.'
          res.redirect(
            sanitizeRedirectPath(stateData.redirect, '/user/settings')
          )
          return
        }

        let user
        try {
          user = await ThirdPartyIdentityManager.promises.login(
            PROVIDER_ID,
            profileWrapper.profile.id,
            externalData
          )
        } catch (err) {
          if (err instanceof ThirdPartyUserNotFoundError) {
            user = await handleFirstTimeLogin(req, profileWrapper, externalData)
            if (!user) {
              res.redirect('/login?oauth=github-email')
              return
            }
          } else {
            throw err
          }
        }

        AuthenticationController.setAuditInfo(req, {
          method: 'GitHub OAuth login',
        })
        req.user_info = { auth_provider: PROVIDER_ID }
        await AuthenticationController.promises.finishLogin(user, req, res)
      } catch (err) {
        next(err)
      }
    }
  )

  webRouter.post(
    '/user/oauth-unlink',
    AuthenticationController.requireLogin(),
    ensureStrategy,
    async (req, res, next) => {
      try {
        const { providerId } = req.body || {}
        if (providerId !== PROVIDER_ID) {
          res.status(400).json({
            message: {
              type: 'error',
              text: 'Unknown OAuth provider.',
            },
          })
          return
        }
        const user = SessionManager.getSessionUser(req.session)
        await ThirdPartyIdentityManager.promises.unlink(user._id, providerId, {
          initiatorId: user._id,
          ipAddress: req.ip,
        })
        res.status(204).end()
      } catch (err) {
        if (err instanceof ThirdPartyIdentityExistsError) {
          res.status(409).json({
            message: {
              type: 'error',
              text: 'Failed to unlink GitHub account.',
            },
          })
          return
        }
        next(err)
      }
    }
  )
}

export default {
  apply: registerRoutes,
}
