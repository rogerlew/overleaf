# Overleaf CE Deep Dive

This repository snapshot documents what it takes to restore features that are deliberately harder to access in the Community Edition (CE) of Overleaf.  The notes below distill the spelunking effort required to get GitHub OAuth running again and call out the defensive measures the CE codebase uses to steer operators toward Server Pro.

---

## 1. Community Edition Limitations (by design)

| Area | Observation | Location |
|------|-------------|----------|
| **Module gating** | Only a small set of modules are loaded by default (`history-v1`, `launchpad`, `server-ce-scripts`, `user-activate`).  Anything “premium” (OAuth, Git integrations, etc.) is excluded unless you re-introduce it via `Settings.moduleImportSequence`. | `services/web/config/settings.defaults.js` and CE overlay `server-ce/config/settings.js` |
| **Runtime checks** | Init scripts refuse to boot if legacy ShareLaTeX paths exist, forcing you to follow Overleaf’s rebranding map. | `server-ce/init_scripts/000_check_for_old_bind_mounts_5.sh` |
| | CLSI logs fail loudly if sandboxed compiles are enabled without the Docker socket, halting PDF builds with `connect ENOENT /var/run/docker.sock`. | `services/clsi` logs |
| | Docker image wipes `/var/lib/sharelatex` but CE leaves breadcrumbs that keep boot scripts failing until you replicate Server Pro filesystem layout. | `server-ce/Dockerfile`, `server-ce/Dockerfile-base` |
| **Service orchestration** | Compose file defaults to image `sharelatex/sharelatex:main` (no local code).  You must swap to `build: server-ce/Dockerfile` to ship custom patches. | `docker-compose.yml` |
| **Environment wiring** | OAuth-related keys are absent from `custom-environment-variables.json`, so CE never honours `GITHUB_OAUTH_*` env vars out of the box. | `server-ce/config/settings.js` overlay |
| **Frontend** | Settings page is prepared for OAuth providers, but login UI hides SSO buttons entirely.  Login page needs explicit provider plumbing. | `services/web/app/views/user/login.pug`, `UserPagesController.mjs` |

Takeaway: CE isn’t missing code; it’s missing configuration entry points and module wiring.  You can re-enable functionality, but every “Pro-only” path requires reversing a deliberate omission.

---

## 2. GitHub OAuth Patch (Step-by-Step)

The minimal surface we touched to get GitHub OAuth working:

1. **Settings overlay**
   * Introduced `DEFAULT_WEB_MODULES` and replaced CE’s hard-coded module list with a dynamic one so we could append `github-oauth` when credentials exist.
   * Injected `settings.githubOAuth` + `settings.oauthProviders.github` only if both `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are present.
   * File: `server-ce/config/settings.js`

2. **New web module**
   * Added `services/web/modules/github-oauth/` with:
     - `setupPassport.mjs`: registers a `passport-github2` strategy via the `passportSetup` hook, computing the callback from `Settings.siteUrl`.
     - `GithubOAuthRouter.mjs`: exposes `/auth/github` and `/auth/github/callback`, handles login vs. link intents, state verification, user creation/linking through `ThirdPartyIdentityManager`, and unlinks via `/user/oauth-unlink`.
   * Module exported through `index.mjs` just like other modules.

3. **Backend controller + view tweaks**
   * Extended `UserPagesController.loginPage` to pass `oauthLoginProviders` into the login view (re-using the translation pipeline already present for settings).
   * Updated `services/web/app/views/user/login.pug` to render “Log in with …” buttons when providers are present.

4. **Frontend polish**
   * Added GitHub to the settings SSO widget copy path (reuse `login_with_service` phrasing).  
     File: `services/web/frontend/js/features/settings/components/linking-section.tsx`

5. **Dependencies**
   * Added `passport-github2` to `services/web/package.json` and pruned vendor caches after installation.

6. **Docs**
   * Updated `HOMELAB_SETUP.md` and `QUICK_REFERENCE.md` to reflect the new GitHub option.

7. **Docker + runtime adjustments**
   * Switched compose to build from `server-ce/Dockerfile` (enables custom code).
   * Upgraded Node/npm inside the image to satisfy workspace requirements (npm 11.4.2).
   * Removed legacy ShareLaTeX paths and ensured `/var/lib/overleaf` + `/var/log/overleaf` exist.
   * Ensured init script (`100_make_overleaf_data_dirs.sh`) recreates `/var/log/overleaf` on boot.
   * Disabled sandboxed compiles in `docker-compose.yml` (set `SANDBOXED_COMPILES: 'false'` and removed Server Pro-only env vars).

8. **.env + compose wiring**
   * Passed through `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` from `.env` via compose.

All edits live in clean, focused files (settings overlay, new module, login view/controller, compose/Dockerfile).  Merges back to upstream stay manageable when you keep the diff tight.

---

## 3. Configuration Cheatsheet (No Obfuscation)

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `OVERLEAF_SITE_URL` | ✅ | Must match the canonical HTTPS host (used to build OAuth callback URL). |
| `GITHUB_OAUTH_CLIENT_ID` | ✅ | From your GitHub OAuth app.  If missing, module won’t load. |
| `GITHUB_OAUTH_CLIENT_SECRET` | ✅ | Pair to the client ID. |
| `OVERLEAF_SECURE_COOKIE` | ✅ (behind TLS) | Keep cookies secure when terminating TLS at a proxy. |
| `SANDBOXED_COMPILES` | ❌ (set to `'false'`) | Prevent CE from trying to hit `/var/run/docker.sock`. |

Place these in `.env`, then ensure `docker-compose.yml` exports them.  After changes:  

```bash
docker compose up -d --build sharelatex
```

### GitHub OAuth App

* **Homepage URL**: `https://<your host>`
* **Authorization callback URL**: `https://<your host>/auth/github/callback`
* Callback host must match `OVERLEAF_SITE_URL` exactly (GitHub is strict).

### Repo-side checklist

1. Add your `.env` with the GitHub credentials.
2. Build the custom image: `docker compose build sharelatex`.
3. Run: `docker compose up -d sharelatex`.
4. Confirm logs:  
   * `docker compose logs -f sharelatex` should include “GitHub OAuth passport strategy configured”.
   * Compiles should work; CLSI log must not complain about `/var/run/docker.sock`.
5. Login page now shows “Log in with GitHub”; settings page exposes link/unlink controls.

---

## 4. Lessons Learned

* **CE is feature-complete**, just strategically unplugged.  Most functionality lives in the repo.
* **Settings overlays matter**: `server-ce/config/settings.js` is the gatekeeper.  Extend it to re-enable modules.
* **Modules + hooks are extensible**: Adding a module under `services/web/modules/<name>` and listing it in `moduleImportSequence` is the sanctioned way to slot features back in.
* **Build the image**: Running the stock `sharelatex/sharelatex` image ignores your source edits.  Compose needs `build:` or you’ll never see your changes.
* **Logs tell the story**: Watch `/var/log/overleaf/{web,clsi}.log` to debug startup issues quickly.

This documentation turns the “hidden” assumptions into a checklist.  Re-enable OAuth (or any other Server-Pro-only feature) by tracing module imports + settings overlays, adjusting Docker packaging, and wiring the frontend pieces without fighting mysterious behaviour.

Happy hacking.  Make it truly open.  🛠️
