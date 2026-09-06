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

## Local recovery: reset-and-onboard

There is no remote or forgotten-password reset. For a local SQLite deployment,
stop Veerabahu, preserve the existing database volume as a backup, and start
with a new database using the deployment's `VB_MASTER_KEY`. With the compose
file's named volume, identify its exact name with `docker volume ls`, then use
your deployment tooling to copy the database out before replacing it; do not
delete the only copy.

```sh
docker compose stop veerabahu
docker compose up -d --build
```

Open the app and complete onboarding again. Keep the backup until the new
configuration is verified; it can be restored under deployment control if
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
