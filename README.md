# Veerabahu

Veerabahu is a local, human-in-the-loop enrichment sidecar for Pi-hole and
AdGuard Home. It reads resolved domains, publishes an approved blocklist, and
never writes to the gatekeeper API.

## Docker deployment

1. Copy the example environment and create the encryption key. The key is
   required to decrypt settings stored in the database and must be kept in the
   deployment secret store:

   ```sh
   cp .env.example .env
   openssl rand -base64 32
   ```

   Put the generated value in `VB_MASTER_KEY` in `.env`. Do not commit `.env`,
   print the key in logs, or paste it into support output. The application
   validates that it decodes to exactly 32 bytes.

2. Start the process and open <http://localhost:3000>:

   ```sh
   docker compose up -d --build
   ```

3. On first run, Veerabahu redirects to onboarding. Create the local admin
   password, configure the Pi-hole or AdGuard Home read-only connection, test
   it, choose reputation sources and quotas, then review and activate. Settings
   and credentials are stored in the encrypted application database; the
   environment file supplies the master-key and process/database bootstrap
   only.

## Upgrading an existing Compose deployment

Keep your existing `.env` and database volume. Add `VB_MASTER_KEY` to that
environment file, then start once with the legacy import override:

```sh
docker compose -f docker-compose.yml -f docker-compose.legacy.yml up -d --build
```

The override passes the existing `.env` runtime values into the container;
ordinary Compose `.env` interpolation alone does not do that. The app imports
them only when no `app_config` row exists and leaves onboarding incomplete.
Open the app, create the admin password, review the imported configuration,
test the gatekeeper, and activate. A positive AI daily budget requires both
input and output prices; set the legacy price variables before importing if
you previously configured a budget without prices.

After onboarding, switch back to the normal Compose file:

```sh
docker compose up -d --force-recreate
```

You can then remove the old runtime variables from `.env`, keeping the same
master key and process/database bootstrap values. Saved database settings take
precedence on later starts. Run one Veerabahu app process per database; settings
saves and scheduler transitions are serialized within that process.

## Local recovery: reset-and-onboard

There is no remote or forgotten-password reset. For a local SQLite deployment,
stop Veerabahu, archive the named database volume, replace only that exact
volume, and start with the deployment's `VB_MASTER_KEY`. Run these commands
from the project directory; the volume filter avoids guessing Compose's
project-name prefix:

```sh
set -eu
docker compose stop veerabahu
docker compose rm -f veerabahu
DATA_VOLUME="$(docker volume ls --filter label=com.docker.compose.volume=veerabahu-data --format '{{.Name}}')"
test -n "$DATA_VOLUME"
docker run --rm -v "$DATA_VOLUME":/data -v "$PWD":/backup alpine \
  tar czf /backup/veerabahu-data-backup.tgz -C /data .
docker volume rm "$DATA_VOLUME"
docker compose up -d --build
```

`test -n` must succeed before the volume command runs; never substitute a
workspace path or an unverified volume name. The archive is the recoverable
backup. Open the app and complete onboarding again, then keep the archive until
the new configuration is verified. Restore it under deployment control if
needed. Do not change or expose the master key during recovery.

## Gatekeeper and adlist refresh

The gatekeeper connection is read-only: Veerabahu pulls resolved-domain data
for enrichment and does not push rules or change gatekeeper settings. After
activation, configure the gatekeeper to subscribe to Veerabahu's published
adlist at:

```text
http://<veerabahu-host>:3000/blocklist.txt
```

Set Pi-hole or AdGuard Home to refresh that adlist on its own schedule; an
approximately hourly refresh is recommended. Veerabahu cannot force a
gatekeeper refresh. The public blocklist endpoint remains unauthenticated so
the gatekeeper can pull it.

## Configuration reference

`.env.example` contains only the master key and process/database bootstrap
values. Configure gatekeeper credentials, source credentials, quotas, scoring,
and scheduler settings through the authenticated Settings page after
onboarding.

Curated lists require at least one list URL, or you must disable that source
and configure another. No lists are bundled. When an AI daily cost ceiling is
positive, enter both token prices so calls contribute to the budget. The
published endpoint is fixed at `/blocklist.txt`, including after legacy import.
