import GithubOAuthRouter from './app/src/GithubOAuthRouter.mjs'
import { setupPassport } from './app/src/setupPassport.mjs'

/** @import { WebModule } from '../../types/web-module' */

/** @type {WebModule} */
const GithubOAuthModule = {
  router: GithubOAuthRouter,
  hooks: {
    promises: {
      passportSetup: setupPassport,
    },
  },
}

export default GithubOAuthModule
