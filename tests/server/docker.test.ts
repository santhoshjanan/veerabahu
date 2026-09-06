import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('docker artifacts', () => {
  it('Dockerfile exists and builds with schedulers disabled', () => {
    expect(existsSync('Dockerfile')).toBe(true);
    expect(readFileSync('Dockerfile', 'utf8')).toContain(
      'VB_DISABLE_SCHEDULERS=true pnpm build'
    );
  });
  it('compose exposes a data volume and keeps Valkey commented out', () => {
    const c = readFileSync('docker-compose.yml', 'utf8');
    expect(c).toContain('veerabahu-data:/app/data');
    expect(c).toMatch(/#\s+valkey:/);
  });
  it('documents the master-key bootstrap without deployment credentials', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('VB_MASTER_KEY');
    expect(readme).toContain('openssl rand -base64 32');
    expect(readme).toContain('reset-and-onboard');
    expect(readme).toContain('read-only');
    expect(readme).toContain('/blocklist.txt');
    expect(readme).toContain('docker compose stop veerabahu');
    expect(readme).toContain('tar czf /backup/veerabahu-data-backup.tgz');
    expect(readme).toContain('test -n "$DATA_VOLUME"');
    expect(readme).toContain('docker volume rm "$DATA_VOLUME"');
  });
  it('keeps the example environment limited to bootstrap values', () => {
    const env = readFileSync('.env.example', 'utf8');
    expect(env).toContain('VB_MASTER_KEY=');
    expect(env).toContain('VB_DATABASE_URL=');
    expect(env).not.toContain('VB_PIHOLE_APP_PASSWORD');
    expect(env).not.toContain('VB_LLM_API_KEY');
    expect(env).not.toContain('VB_METADEFENDER_API_KEY');
  });
  it('passes the master key to the container without legacy credentials', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');
    expect(compose).toContain('VB_MASTER_KEY: ${VB_MASTER_KEY}');
    expect(compose).not.toContain('VB_PIHOLE_APP_PASSWORD');
  });
});
