# Overleaf Homelab Setup Guide

## Configuration Summary

Your Overleaf instance is configured for:
- **External host**: value of `EXTERNAL_HOST` in `.env` (e.g. `https://overleaf.example.com`)
- **Port**: `${EXTERNAL_PORT}` (host, default `80`) → `80` (container)
- **TLS**: Terminated at HAProxy (pfSense)
- **Protocol**: HTTPS (handled by HAProxy)

## Docker Compose Configuration

The `docker-compose.yml` has been configured with:

### Core Settings
- `OVERLEAF_SITE_URL`: `${EXTERNAL_HOST}`
- `OVERLEAF_SECURE_COOKIE`: optional (`'true'` when terminating TLS upstream)
- `OVERLEAF_BEHIND_PROXY`: optional (`'true'` when running behind a reverse proxy)
- `OVERLEAF_TRUSTED_PROXY_IPS`: adjust for your proxy network (e.g. `loopback,linklocal,uniquelocal`)

### HAProxy Configuration Required

In your pfSense HAProxy configuration, ensure:

1. **Backend Configuration**:
   - Server: `overleaf-server`
   - IP: Your Docker host IP
   - Port: host port mapped to the container (`${EXTERNAL_PORT}`, default `80`)
   - SSL: Not checked (TLS terminated at HAProxy)
   - **Health Check**: Configure health check using one of these endpoints:
     - Path: `/status` (simple status check)
     - Path: `/health_check` (full health check including Redis/MongoDB)
     - Method: GET
     - Expected Status: 200

2. **Frontend Configuration**:
   - External Address: `*:443`
   - Type: `https / ssl offloading`
   - Certificate: Your DuckDNS wildcard cert or specific cert
   - Backend: Your Overleaf backend

3. **ACL Configuration** (if needed):
   - Name: `overleaf_host`
   - Expression: `Host matches`
   - Value: `<your external host>`

4. **Important Headers** (add these in HAProxy backend configuration):
   ```
   http-request set-header X-Forwarded-Proto https if { ssl_fc }
   http-request set-header X-Forwarded-Host <your external host>
   ```
   
   **Note:** `X-Forwarded-For` is automatically added by HAProxy by default

## OAuth / SSO Capabilities

### Community Edition Limitations

**OAuth providers are primarily a Server Pro feature.**

The Community Edition has:
- ✅ Basic local user authentication
- ✅ LDAP support (configured via environment variables)
- ✅ Custom GitHub OAuth (via code changes in this repo)
- ❌ SAML support (Server Pro only)
- ❌ Other OAuth providers (Google / ORCID) without additional work

### To Enable OAuth (Requires Code Changes or Server Pro)

If you need OAuth, you have two options:

#### Option 1: Upgrade to Server Pro
- Full SAML/OAuth/LDAP support
- Google, ORCID, IEEE Collabratec integration
- Professional support
- More info: https://www.overleaf.com/for/enterprises

#### Option 2: LDAP (Available in Community Edition)
The Community Edition supports LDAP authentication. Uncomment these in docker-compose.yml:

```yaml
OVERLEAF_LDAP_URL: 'ldap://your-ldap-server:389'
OVERLEAF_LDAP_SEARCH_BASE: 'ou=people,dc=example,dc=com'
OVERLEAF_LDAP_SEARCH_FILTER: '(uid={{username}})'
OVERLEAF_LDAP_BIND_DN: 'cn=admin,dc=example,dc=com'
OVERLEAF_LDAP_BIND_CREDENTIALS: 'your-password'
OVERLEAF_LDAP_EMAIL_ATT: 'mail'
OVERLEAF_LDAP_NAME_ATT: 'cn'
OVERLEAF_LDAP_LAST_NAME_ATT: 'sn'
OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN: 'true'
```

#### Option 3: Custom OAuth Integration
GitHub OAuth support is already wired into this fork:
- Populate `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` in `overleaf/.env`
- Restart the stack (`docker compose up -d sharelatex`) to load the new credentials
- Users will see a “Log in with GitHub” option and can link accounts from **Account Settings → Linked Accounts**

For other providers you still need to modify the Overleaf settings files directly:
- Edit `/services/web/config/settings.defaults.js` and add a provider entry
- Extend the passport setup logic in `services/web/modules` similar to the GitHub module
- Rebuild / restart the container after changes

## Email Configuration (Optional)

To enable email notifications, uncomment and configure these variables:

### For Gmail/Google Workspace:
```yaml
OVERLEAF_EMAIL_FROM_ADDRESS: "overleaf@example.com"
OVERLEAF_EMAIL_SMTP_HOST: smtp.gmail.com
OVERLEAF_EMAIL_SMTP_PORT: 587
OVERLEAF_EMAIL_SMTP_SECURE: false
OVERLEAF_EMAIL_SMTP_USER: your-email@gmail.com
OVERLEAF_EMAIL_SMTP_PASS: your-app-password
OVERLEAF_EMAIL_SMTP_TLS_REJECT_UNAUTH: true
```

### For Other SMTP Servers:
Adjust the host, port, and credentials accordingly.

## Starting Overleaf

```bash
# Start the services
docker-compose up -d

# Check logs
docker-compose logs -f sharelatex

# Create your first admin user
docker exec sharelatex /bin/bash -c "cd /overleaf/services/web && node modules/server-ce-scripts/scripts/create-admin-user.js admin@example.com"
```

## Data Persistence

Data is stored in:
- `~/sharelatex_data` - Overleaf application data
- `~/mongo_data` - MongoDB database
- `~/redis_data` - Redis cache

**Backup these directories regularly!**

## Health Check Endpoints

Overleaf provides several health check endpoints that you can use with HAProxy:

### Available Endpoints

1. **`GET /status`** - Basic status check
   - Returns: `"web is alive (web)"` (200 OK)
   - Use: Simple aliveness check
   - Checks: Site open/closed status

2. **`GET /health_check`** - Full health check
   - Returns: 200 OK if healthy, 500 if unhealthy
   - Use: Comprehensive health verification
   - Checks: Active handles, Redis, MongoDB, and smoke tests

3. **`GET /health_check/redis`** - Redis health check
   - Returns: 200 OK if Redis is healthy
   - Use: Verify Redis connectivity

4. **`GET /health_check/mongo`** - MongoDB health check
   - Returns: 200 OK if MongoDB is healthy
   - Use: Verify MongoDB connectivity

### Recommended for HAProxy

Use `/status` for basic health checks in HAProxy:
- Fast response
- Low overhead
- Checks if the service is running

Example HAProxy health check configuration:
```
option httpchk GET /status
http-check expect status 200
```

For more thorough checks (less frequent), use `/health_check`:
```
option httpchk GET /health_check
http-check expect status 200
```

### Testing Health Endpoints

Test from your Docker host:
```bash
# Basic status check
curl http://localhost:8267/status

# Full health check
curl http://localhost:8267/health_check

# Redis health check
curl http://localhost:8267/health_check/redis

# MongoDB health check
curl http://localhost:8267/health_check/mongo
```

Test from pfSense (replace with your Docker host IP):
```bash
curl http://192.168.x.x:8267/status
```

## Troubleshooting

### Connection Issues
1. Check HAProxy backend is running: `docker-compose ps`
2. Verify HAProxy can reach the Docker host on port 8267
3. Check HAProxy logs for connection errors
4. Ensure port 8267 on Docker host is accessible to pfSense
5. Test the health endpoint directly: `curl http://your-docker-host:8267/status`

### HTTPS/Cookie Issues
If you get redirect loops or cookie errors:
1. Verify `OVERLEAF_SECURE_COOKIE: 'true'` is set
2. Ensure HAProxy is sending `X-Forwarded-Proto: https` header
3. Check `OVERLEAF_TRUSTED_PROXY_IPS` includes your HAProxy IP range

### Access Overleaf Logs
```bash
docker-compose logs -f sharelatex
```

## Security Recommendations

1. **Set a session secret**:
   ```yaml
   OVERLEAF_SESSION_SECRET: "generate-a-random-32-char-string-here"
   ```

2. **Regular backups**: Backup MongoDB and sharelatex_data regularly

3. **Firewall**: Ensure only HAProxy can access port 8267 on the Docker host

4. **Updates**: Keep Overleaf updated:
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

## Resources

- [Overleaf Wiki](https://github.com/overleaf/overleaf/wiki)
- [Overleaf Toolkit](https://github.com/overleaf/toolkit/)
- [Server Pro Documentation](https://docs.overleaf.com/)
