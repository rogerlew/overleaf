import { URL } from 'node:url'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { Strategy as GitHubStrategy } from 'passport-github2'

let strategyConfigured = false

export function isStrategyConfigured() {
  return strategyConfigured
}

export async function setupPassport(passport) {
  const { githubOAuth, siteUrl } = Settings
  const clientId = githubOAuth?.clientId
  const clientSecret = githubOAuth?.clientSecret

  if (!clientId || !clientSecret) {
    logger.info(
      'GitHub OAuth credentials are not configured; skipping passport strategy setup'
    )
    strategyConfigured = false
    return
  }

  let callbackURL
  try {
    callbackURL = new URL('/auth/github/callback', siteUrl).toString()
  } catch (err) {
    logger.error(
      { err, siteUrl },
      'failed to construct GitHub OAuth callback URL'
    )
    strategyConfigured = false
    throw err
  }

  passport.use(
    new GitHubStrategy(
      {
        clientID: clientId,
        clientSecret,
        callbackURL,
        passReqToCallback: true,
        scope: ['read:user', 'user:email'],
      },
      (req, accessToken, refreshToken, profile, done) => {
        done(null, { profile, accessToken, refreshToken })
      }
    )
  )

  strategyConfigured = true
  logger.info('GitHub OAuth passport strategy configured')
}
