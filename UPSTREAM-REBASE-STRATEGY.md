
## Keeping This Fork Up to Date

We maintain a long–lived branch (`feature/github-oauth-ce`) on top of upstream `main` to restore GitHub OAuth and other Community Edition tweaks. To bring in the latest changes from Overleaf:

```bash
git checkout feature/github-oauth-ce
git fetch upstream
git rebase upstream/main
```

Resolve any conflicts, then rebuild and redeploy the `sharelatex` service to ensure the patched Docker image is up to date:

```bash
docker compose build sharelatex
docker compose up -d sharelatex
```

If the rebase introduced package updates, reinstall dependencies (e.g. `npm install` inside `services/web`) before rebuilding. When the branch is ready, push it to your fork:

```bash
git push origin feature/github-oauth-ce --force-with-lease
```

Keeping the diff localized (settings overlay, GitHub module, login UI, Dockerfile/compose, docs) makes rebases straightforward. Review `AGENTS.md` for a detailed mapping of the modifications in this branch.

