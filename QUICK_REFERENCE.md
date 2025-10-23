# Overleaf Homelab - Quick Reference

## 🚀 Quick Start

```bash
# Start Overleaf
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f sharelatex

# Create admin user
docker exec sharelatex /bin/bash -c "cd /overleaf/services/web && node modules/server-ce-scripts/scripts/create-admin-user.js admin@example.com"
```



## 🔧 Configuration

| Setting | Value |
|---------|-------|
| **External URL** | value of `EXTERNAL_HOST` in `.env` (e.g. `https://overleaf.example.com`) |
| **Host Port** | value of `EXTERNAL_PORT` in `.env` (default `80`) |
| **Container Port** | `80` |
| **TLS** | Terminated at HAProxy |

## 🏥 Health Check Endpoints

| Endpoint | Purpose | Use In HAProxy |
|----------|---------|----------------|
| `/status` | Basic aliveness | ✅ Recommended |
| `/health_check` | Full health (Redis + MongoDB) | ⚡ Thorough |
| `/health_check/redis` | Redis connectivity | 🔍 Specific |
| `/health_check/mongo` | MongoDB connectivity | 🔍 Specific |

### Test Health Checks

```bash
# From Docker host
curl http://localhost:${EXTERNAL_PORT:-80}/status

# From network
curl http://your-docker-host-ip:${EXTERNAL_PORT:-80}/status

> Replace `${EXTERNAL_PORT:-80}` with your actual exposed port if the shell does not expand it automatically.
```

## 🛡️ HAProxy Configuration

### Backend Server
```
Server: overleaf
Address: <docker-host-ip>:8267
Health Check: GET /status
Expected: 200 OK
```

### Required Headers (HAProxy Format)
```
http-request set-header X-Forwarded-Proto https if { ssl_fc }
http-request set-header X-Forwarded-Host <your external host>
```

**Note:** `X-Forwarded-For` is automatically added by HAProxy
## 📁 Data Locations

```bash
~/sharelatex_data  # Application data
~/mongo_data       # Database
~/redis_data       # Cache
```

**⚠️ BACKUP THESE REGULARLY!**

## 🔐 Important Environment Variables

```yaml
OVERLEAF_SITE_URL: ${EXTERNAL_HOST}
OVERLEAF_SECURE_COOKIE: 'true'
OVERLEAF_BEHIND_PROXY: 'true'
OVERLEAF_TRUSTED_PROXY_IPS: 'loopback,linklocal,uniquelocal'
```

## 🐛 Common Issues

### Can't connect
1. Check container is running: `docker-compose ps`
2. Test health endpoint: `curl http://localhost:8267/status`
3. Verify HAProxy can reach port 8267
4. Check firewall rules

### Cookie/Login issues
1. Verify `OVERLEAF_SECURE_COOKIE: 'true'`
2. Check HAProxy sends `X-Forwarded-Proto: https`
3. Verify `OVERLEAF_SITE_URL` uses `https://`

### Performance issues
1. Check logs: `docker-compose logs -f`
2. Monitor resources: `docker stats`
3. Verify MongoDB replica set: `docker exec mongo mongosh --eval "rs.status()"`

## 📧 Email Setup (Optional)

Uncomment in `docker-compose.yml`:
```yaml
OVERLEAF_EMAIL_FROM_ADDRESS: "overleaf@example.com"
OVERLEAF_EMAIL_SMTP_HOST: smtp.gmail.com
OVERLEAF_EMAIL_SMTP_PORT: 587
OVERLEAF_EMAIL_SMTP_USER: your-email@gmail.com
OVERLEAF_EMAIL_SMTP_PASS: your-app-password
```

## 🔄 Maintenance

```bash
# Update Overleaf
docker-compose pull
docker-compose up -d

# Backup
tar -czf overleaf-backup-$(date +%Y%m%d).tar.gz \
  ~/sharelatex_data ~/mongo_data ~/redis_data

# Restart
docker-compose restart sharelatex

# Stop
docker-compose down

# Full cleanup (⚠️ DELETES DATA)
docker-compose down -v
```

## ⚠️ OAuth / SSO

**Not easily available in Community Edition!**

Options:
- ✅ **LDAP**: Supported (configure in docker-compose.yml)
- ✅ **GitHub OAuth**: Set `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` in `.env`, then restart web
- ❌ **Other OAuth providers** (Google / ORCID): Server Pro or custom code
- ❌ **SAML**: Server Pro only

See `HOMELAB_SETUP.md` for details.

## 📚 Resources

- [Full Setup Guide](./HOMELAB_SETUP.md)
- [Overleaf Wiki](https://github.com/overleaf/overleaf/wiki)
- [Overleaf Toolkit](https://github.com/overleaf/toolkit/)
