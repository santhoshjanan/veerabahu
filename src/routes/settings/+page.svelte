<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { enhance } from '$app/forms';
  import SecretField from '$lib/components/SecretField.svelte';
  import SettingsSection from '$lib/components/SettingsSection.svelte';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  const actionData = $derived(form as any);
  const dirty = $state<Record<string, boolean>>({});
  const hasDirty = $derived(Object.values(dirty).some(Boolean));
  const settings = $derived(data.settings);
  const sourceNames = [
    ['curated_list', 'Curated lists', 'curatedList'],
    ['metadefender', 'MetaDefender', 'metadefender'],
    ['ai', 'AI provider', 'ai'],
    ['virustotal', 'VirusTotal', 'virustotal']
  ] as const;
  const quotaFields = [
    ['PerMinute', 'Per minute', 'perMinute'],
    ['PerDay', 'Per day', 'perDay'],
    ['PerMonth', 'Per month', 'perMonth']
  ] as const;
  const testMessages: Record<string, string> = {
    connected: 'Connected. Gatekeeper read access is working.',
    auth_rejected: 'Authentication rejected. Check the credential and try again.',
    unreachable: 'Gatekeeper unreachable. Check the URL and network.',
    invalid_response: 'Gatekeeper returned an unexpected response.'
  };

  const submitted = (section: string, name: string, fallback: unknown = '') =>
    actionData?.section === section && actionData?.values && name in actionData.values
      ? actionData.values[name]
      : (fallback ?? '');
  const submittedCheck = (section: string, name: string, fallback: boolean) =>
    actionData?.section === section && actionData?.values
      ? Boolean(actionData.values[name])
      : fallback;
  const errorFor = (section: string, name: string) =>
    actionData?.section === section
      ? (actionData?.errors?.[name] as string | undefined)
      : undefined;
  const errorId = (section: string, name: string) =>
    errorFor(section, name) ? `${section}-${name}-error` : undefined;
  const sourceState = (source: keyof typeof settings.sources) => {
    const value = settings.sources[source];
    if (!value.enabled) return 'Disabled';
    if (source === 'curated_list' || value.secretConfigured) return 'Active';
    return 'Unavailable — re-enter credential';
  };

  beforeNavigate(({ cancel, to }) => {
    if (
      hasDirty &&
      to?.url.pathname !== window.location.pathname &&
      !window.confirm('Discard your unsaved settings changes?')
    )
      cancel();
  });

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!hasDirty) return;
    event.preventDefault();
    event.returnValue = '';
  }

  const enhanceSection = (section: string): SubmitFunction =>
    () =>
    async ({ result, update }) => {
      const data = 'data' in result ? (result.data as any) : null;
      await update();
      if (result.type === 'redirect' || data?.saved) dirty[section] = false;
    };
</script>

{#snippet fieldError(section: string, name: string)}
  {#if errorFor(section, name)}
    <small id={`${section}-${name}-error`} class="field-error">{errorFor(section, name)}</small>
  {/if}
{/snippet}

<svelte:head>
  <title>Settings — Veerabahu</title>
</svelte:head>

<svelte:window onbeforeunload={beforeUnload} />

<header class="page-heading">
  <div>
    <h1>Settings</h1>
    <p>Configuration is stored locally. Each section saves independently.</p>
  </div>
  <form method="POST" action="?/signout">
    <button class="secondary" type="submit">Sign out</button>
  </form>
</header>

{#if actionData?.restartFailed}
  <p class="notice error" role="alert">{actionData.error}</p>
{:else if actionData?.saved}
  <p class="notice" role="status">{actionData.section === 'gatekeeper' ? 'Connection tested and settings saved.' : 'Settings saved.'}</p>
{:else if actionData?.error}
  <p class="notice error" role="alert">{actionData.error}</p>
{/if}

<div class="settings-layout">
  <nav class="index" aria-label="Settings sections">
    <ol>
      <li><a href="#access">Access</a></li>
      <li><a href="#gatekeeper">Gatekeeper</a></li>
      <li><a href="#sources">Sources</a></li>
      <li><a href="#quota-cost">Quota &amp; cost</a></li>
      <li><a href="#scoring">Scoring</a></li>
      <li><a href="#system">System</a></li>
    </ol>
  </nav>

  <div class="sections">
    <div id="access">
      <SettingsSection title="Access" description="Change the only local administrator password. All sessions will be signed out.">
        <form method="POST" action="?/password" use:enhance={enhanceSection('access')} oninput={() => (dirty.access = true)}>
          <SecretField name="currentPassword" label="Current password" autocomplete="current-password" error={errorFor('access', 'currentPassword')} />
          <SecretField name="newPassword" label="New password" autocomplete="new-password" error={errorFor('access', 'newPassword')} />
          <SecretField name="passwordConfirm" label="Confirm new password" autocomplete="new-password" error={errorFor('access', 'passwordConfirm')} />
          <p class="hint">Use at least 12 characters. Saving signs out every active session.</p>
          <button type="submit">Change password</button>
        </form>
      </SettingsSection>
    </div>

    <div id="gatekeeper">
      <SettingsSection title="Gatekeeper" description="Test read-only query-log access before saving connection changes.">
        <form method="POST" action="?/gatekeeper" use:enhance={enhanceSection('gatekeeper')} oninput={() => (dirty.gatekeeper = true)}>
          <div class="state-row">
            <strong>{settings.gatekeeper?.secretConfigured ? 'Credential stored' : 'Credential unavailable'}</strong>
            <span>{settings.gatekeeper?.type === 'adguard' ? 'AdGuard Home' : 'Pi-hole'}</span>
          </div>
          <label>
            <span>Gatekeeper</span>
            <select name="type" value={submitted('gatekeeper', 'type', settings.gatekeeper?.type ?? 'pihole')} aria-invalid={errorFor('gatekeeper', 'type') ? 'true' : undefined} aria-describedby={errorId('gatekeeper', 'type')}>
              <option value="pihole">Pi-hole</option>
              <option value="adguard">AdGuard Home</option>
            </select>
            {@render fieldError('gatekeeper', 'type')}
          </label>
          <label>
            <span>Gatekeeper URL</span>
            <input name="baseUrl" type="url" required value={submitted('gatekeeper', 'baseUrl', settings.gatekeeper?.baseUrl)} aria-invalid={errorFor('gatekeeper', 'baseUrl') ? 'true' : undefined} aria-describedby={errorId('gatekeeper', 'baseUrl')} />
            {@render fieldError('gatekeeper', 'baseUrl')}
          </label>
          <label>
            <span>Username <small>(AdGuard only)</small></span>
            <input name="username" value={submitted('gatekeeper', 'username', settings.gatekeeper?.username)} aria-invalid={errorFor('gatekeeper', 'username') ? 'true' : undefined} aria-describedby={errorId('gatekeeper', 'username')} />
            {@render fieldError('gatekeeper', 'username')}
          </label>
          <SecretField name="password" label="Password" configured={settings.gatekeeper?.secretConfigured} error={errorFor('gatekeeper', 'password')} describedby={actionData?.section === 'gatekeeper' && actionData?.testStatus ? 'gatekeeper-test-status' : undefined} />
          {#if actionData?.section === 'gatekeeper' && actionData?.testStatus}
            <p id="gatekeeper-test-status" class:failure={actionData.testStatus !== 'connected'} class="connection" role="status">{testMessages[actionData.testStatus]}</p>
          {/if}
          <button type="submit">Test and save</button>
        </form>
      </SettingsSection>
    </div>

    <div id="sources">
      <SettingsSection title="Sources" description="Enable only the reputation services you use. Empty credential fields keep the stored value.">
        <form method="POST" action="?/sources" use:enhance={enhanceSection('sources')} oninput={() => (dirty.sources = true)}>
          <fieldset>
            <legend>Curated lists <span class="source-state">{sourceState('curated_list')}</span></legend>
            <label class="check"><input name="curatedListEnabled" type="checkbox" checked={submittedCheck('sources', 'curatedListEnabled', settings.sources.curated_list.enabled)} aria-invalid={errorFor('sources', 'curatedListEnabled') ? 'true' : undefined} aria-describedby={errorId('sources', 'curatedListEnabled')} /> Enabled</label>
            {@render fieldError('sources', 'curatedListEnabled')}
            <label>
              <span>List URLs <small>(one per line)</small></span>
              <textarea name="curatedListUrls" rows="3" aria-invalid={errorFor('sources', 'curatedListUrls') ? 'true' : undefined} aria-describedby={errorId('sources', 'curatedListUrls')}>{submitted('sources', 'curatedListUrls', settings.curatedListUrls.join('\n'))}</textarea>
              {@render fieldError('sources', 'curatedListUrls')}
            </label>
          </fieldset>

          <fieldset>
            <legend>MetaDefender <span class="source-state">{sourceState('metadefender')}</span></legend>
            <label class="check"><input name="metadefenderEnabled" type="checkbox" checked={submittedCheck('sources', 'metadefenderEnabled', settings.sources.metadefender.enabled)} /> Enabled</label>
            <label><span>Endpoint</span><input name="metadefenderBaseUrl" type="url" value={submitted('sources', 'metadefenderBaseUrl', settings.sources.metadefender.baseUrl)} aria-invalid={errorFor('sources', 'metadefenderBaseUrl') ? 'true' : undefined} aria-describedby={errorId('sources', 'metadefenderBaseUrl')} />{@render fieldError('sources', 'metadefenderBaseUrl')}</label>
            <SecretField name="metadefenderApiKey" label="API key" configured={settings.sources.metadefender.secretConfigured} error={errorFor('sources', 'metadefenderApiKey')} />
          </fieldset>

          <fieldset>
            <legend>AI provider <span class="source-state">{sourceState('ai')}</span></legend>
            <label class="check"><input name="aiEnabled" type="checkbox" checked={submittedCheck('sources', 'aiEnabled', settings.sources.ai.enabled)} /> Enabled</label>
            <label><span>Endpoint</span><input name="aiBaseUrl" type="url" value={submitted('sources', 'aiBaseUrl', settings.sources.ai.baseUrl)} aria-invalid={errorFor('sources', 'aiBaseUrl') ? 'true' : undefined} aria-describedby={errorId('sources', 'aiBaseUrl')} />{@render fieldError('sources', 'aiBaseUrl')}</label>
            <label><span>Model</span><input name="aiModel" value={submitted('sources', 'aiModel', settings.sources.ai.model)} aria-invalid={errorFor('sources', 'aiModel') ? 'true' : undefined} aria-describedby={errorId('sources', 'aiModel')} />{@render fieldError('sources', 'aiModel')}</label>
            <SecretField name="aiApiKey" label="API key" configured={settings.sources.ai.secretConfigured} error={errorFor('sources', 'aiApiKey')} />
          </fieldset>

          <fieldset>
            <legend>VirusTotal <span class="source-state">{sourceState('virustotal')}</span></legend>
            <label class="check"><input name="virustotalEnabled" type="checkbox" checked={submittedCheck('sources', 'virustotalEnabled', settings.sources.virustotal.enabled)} /> Enabled</label>
            <label><span>Endpoint</span><input name="virustotalBaseUrl" type="url" value={submitted('sources', 'virustotalBaseUrl', settings.sources.virustotal.baseUrl)} aria-invalid={errorFor('sources', 'virustotalBaseUrl') ? 'true' : undefined} aria-describedby={errorId('sources', 'virustotalBaseUrl')} />{@render fieldError('sources', 'virustotalBaseUrl')}</label>
            <SecretField name="virustotalApiKey" label="API key" configured={settings.sources.virustotal.secretConfigured} error={errorFor('sources', 'virustotalApiKey')} />
          </fieldset>
          <button type="submit">Save sources</button>
        </form>
      </SettingsSection>
    </div>

    <div id="quota-cost">
      <SettingsSection title="Quota &amp; cost" description="Blank limits mean no ceiling. Set provider prices per million tokens.">
        <form method="POST" action="?/quotas" use:enhance={enhanceSection('quotas')} oninput={() => (dirty.quotas = true)}>
          {#each sourceNames as [source, label, prefix]}
            <fieldset class="quota">
              <legend>{label}</legend>
              {#each quotaFields as [suffix, labelText, limitName]}
                <label><span>{labelText}</span><input name={`${prefix}${suffix}`} type="number" min="0" step="any" value={submitted('quotas', `${prefix}${suffix}`, settings.quotas[source][limitName])} aria-invalid={errorFor('quotas', `${prefix}${suffix}`) ? 'true' : undefined} aria-describedby={errorId('quotas', `${prefix}${suffix}`)} />{@render fieldError('quotas', `${prefix}${suffix}`)}</label>
              {/each}
            </fieldset>
          {/each}
          <fieldset>
            <legend>AI cost</legend>
            <div class="grid three">
              <label><span>Daily ceiling (USD)</span><input name="aiDailyCostCeilingUsd" type="number" min="0" step="any" value={submitted('quotas', 'aiDailyCostCeilingUsd', settings.quotas.ai.dailyCostCeilingUsd)} aria-invalid={errorFor('quotas', 'aiDailyCostCeilingUsd') ? 'true' : undefined} aria-describedby={errorId('quotas', 'aiDailyCostCeilingUsd')} />{@render fieldError('quotas', 'aiDailyCostCeilingUsd')}</label>
              <label><span>Input / million tokens</span><input name="aiPriceInputPerMTok" type="number" min="0" step="any" value={submitted('quotas', 'aiPriceInputPerMTok', settings.sources.ai.priceInputPerMTok)} aria-invalid={errorFor('quotas', 'aiPriceInputPerMTok') ? 'true' : undefined} aria-describedby={errorId('quotas', 'aiPriceInputPerMTok')} />{@render fieldError('quotas', 'aiPriceInputPerMTok')}</label>
              <label><span>Output / million tokens</span><input name="aiPriceOutputPerMTok" type="number" min="0" step="any" value={submitted('quotas', 'aiPriceOutputPerMTok', settings.sources.ai.priceOutputPerMTok)} aria-invalid={errorFor('quotas', 'aiPriceOutputPerMTok') ? 'true' : undefined} aria-describedby={errorId('quotas', 'aiPriceOutputPerMTok')} />{@render fieldError('quotas', 'aiPriceOutputPerMTok')}</label>
            </div>
          </fieldset>
          <button type="submit">Save quota &amp; cost</button>
        </form>
      </SettingsSection>
    </div>

    <div id="scoring">
      <SettingsSection title="Scoring" description="Weights control how strongly each enabled source contributes to a domain score.">
        <form method="POST" action="?/weights" use:enhance={enhanceSection('weights')} oninput={() => (dirty.weights = true)}>
          <div class="grid two">
            {#each sourceNames as [source, label, prefix]}
              <label><span>{label}</span><input name={`${prefix}Weight`} type="number" min="0" step="any" required value={submitted('weights', `${prefix}Weight`, settings.weights[source])} aria-invalid={errorFor('weights', `${prefix}Weight`) ? 'true' : undefined} aria-describedby={errorId('weights', `${prefix}Weight`)} />{@render fieldError('weights', `${prefix}Weight`)}</label>
            {/each}
          </div>
          <button type="submit">Save scoring</button>
        </form>
      </SettingsSection>
    </div>

    <div id="system">
      <SettingsSection title="System" description="Control scheduler operation and the published blocklist endpoint.">
        <form method="POST" action="?/system" use:enhance={enhanceSection('system')} oninput={() => (dirty.system = true)}>
          <div class="state-row">
            <strong>{settings.activated ? 'Scheduler active' : 'Scheduler stopped'}</strong>
            <label class="check"><input name="activated" type="checkbox" checked={submittedCheck('system', 'activated', settings.activated)} /> Run scheduler</label>
          </div>
          <div class="grid two">
            <label><span>Ingest interval (minutes)</span><input name="ingestIntervalMinutes" type="number" min="0.01" step="any" required value={submitted('system', 'ingestIntervalMinutes', settings.scheduler.ingestIntervalMinutes)} aria-invalid={errorFor('system', 'ingestIntervalMinutes') ? 'true' : undefined} aria-describedby={errorId('system', 'ingestIntervalMinutes')} />{@render fieldError('system', 'ingestIntervalMinutes')}</label>
            <label><span>First-run lookback (hours)</span><input name="firstRunLookbackHours" type="number" min="0" step="any" required value={submitted('system', 'firstRunLookbackHours', settings.scheduler.firstRunLookbackHours)} aria-invalid={errorFor('system', 'firstRunLookbackHours') ? 'true' : undefined} aria-describedby={errorId('system', 'firstRunLookbackHours')} />{@render fieldError('system', 'firstRunLookbackHours')}</label>
            <label><span>First-run domain cap</span><input name="firstRunCap" type="number" min="0" step="1" required value={submitted('system', 'firstRunCap', settings.scheduler.firstRunCap)} aria-invalid={errorFor('system', 'firstRunCap') ? 'true' : undefined} aria-describedby={errorId('system', 'firstRunCap')} />{@render fieldError('system', 'firstRunCap')}</label>
            <label><span>Maximum review wait (hours)</span><input name="maxReviewWaitHours" type="number" min="0" step="any" required value={submitted('system', 'maxReviewWaitHours', settings.scheduler.maxReviewWaitHours)} aria-invalid={errorFor('system', 'maxReviewWaitHours') ? 'true' : undefined} aria-describedby={errorId('system', 'maxReviewWaitHours')} />{@render fieldError('system', 'maxReviewWaitHours')}</label>
          </div>
          <aside>
            <strong>Gatekeeper pull required</strong>
            <p>Add <a href={settings.scheduler.blocklistPath}>{settings.scheduler.blocklistPath}</a> as a blocklist in your gatekeeper and refresh it roughly every hour.</p>
          </aside>
          <button type="submit">Save system</button>
        </form>
      </SettingsSection>
    </div>
  </div>
</div>

<style>
  .page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--vb-s5); margin-bottom: var(--vb-s5); }
  h1 { margin: 0; font: 700 var(--vb-fs-h1) / 1.1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); }
  .page-heading p { max-width: 65ch; margin: var(--vb-s2) 0 0; color: var(--vb-ink-soft); }
  .settings-layout { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: var(--vb-s5); align-items: start; }
  .index { position: sticky; top: 86px; border-top: 2px solid var(--vb-rule-strong); background: var(--vb-ground-sunk); }
  .index ol { list-style: none; margin: 0; padding: 0; }
  .index li { border-bottom: var(--vb-line); }
  .index a { display: block; padding: var(--vb-s3); color: var(--vb-ink-soft); font: var(--vb-fs-small) / 1 var(--vb-font-mono); text-decoration: none; }
  .index a:hover { color: var(--vb-ink); background: var(--vb-ground-raised); }
  .index a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, aside a:focus-visible { outline: 3px solid var(--vb-st-pending_review); outline-offset: 2px; }
  .sections { display: grid; gap: var(--vb-s6); min-width: 0; }
  .sections > div { scroll-margin-top: 84px; }
  form { display: grid; gap: var(--vb-s4); }
  label { display: grid; gap: var(--vb-s1); font-weight: 600; }
  label small { color: var(--vb-ink-soft); font-weight: 400; }
  input, select, textarea, button { font: inherit; }
  input:not([type='checkbox']), select, textarea { width: 100%; min-height: 42px; border: 1px solid var(--vb-rule-strong); border-radius: var(--vb-radius); padding: var(--vb-s2) var(--vb-s3); background: var(--vb-ground-raised); color: var(--vb-ink); }
  textarea { resize: vertical; }
  fieldset { display: grid; gap: var(--vb-s3); margin: 0; padding: var(--vb-s4); border: var(--vb-line); }
  legend { padding: 0 var(--vb-s2); font: 700 var(--vb-fs-small) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: .06em; }
  .source-state { margin-left: var(--vb-s2); color: var(--vb-ink-soft); font-weight: 400; letter-spacing: 0; text-transform: none; }
  .check { display: flex; align-items: center; gap: var(--vb-s2); }
  .hint, .connection { margin: 0; color: var(--vb-ink-soft); font-size: var(--vb-fs-small); }
  .connection { color: var(--vb-success); }
  .connection.failure, .field-error { color: var(--vb-danger); }
  .field-error { font-weight: 400; }
  .state-row { display: flex; align-items: center; justify-content: space-between; gap: var(--vb-s3); padding-bottom: var(--vb-s3); border-bottom: var(--vb-line); }
  .state-row span { color: var(--vb-ink-soft); }
  .quota { grid-template-columns: repeat(3, 1fr); }
  .quota legend { float: left; width: 100%; }
  .grid { display: grid; gap: var(--vb-s3); }
  .grid.two { grid-template-columns: repeat(2, 1fr); }
  .grid.three { grid-template-columns: repeat(3, 1fr); }
  button { justify-self: start; min-height: 42px; border: 0; border-radius: var(--vb-radius); padding: var(--vb-s2) var(--vb-s5); background: var(--vb-accent); color: var(--vb-accent-ink); font-weight: 700; cursor: pointer; }
  button:hover { filter: brightness(.94); }
  button:active { transform: translateY(1px); }
  button.secondary { border: 1px solid var(--vb-rule-strong); background: transparent; color: var(--vb-ink); }
  .notice { margin: 0 0 var(--vb-s5); padding: var(--vb-s3); border: 1px solid var(--vb-success); background: var(--vb-ground-raised); }
  .notice.error { border-color: var(--vb-danger); color: var(--vb-danger); }
  aside { padding: var(--vb-s4); border: 1px solid var(--vb-st-pending_review); background: var(--vb-ground-sunk); }
  aside p { margin: var(--vb-s2) 0 0; }
  aside a { color: var(--vb-ink); font-family: var(--vb-font-mono); text-underline-offset: 3px; }
  @media (max-width: 720px) {
    .page-heading { align-items: stretch; }
    .settings-layout { grid-template-columns: 1fr; }
    .index { position: static; overflow-x: auto; }
    .index ol { display: flex; min-width: max-content; }
    .index li { border-right: var(--vb-line); border-bottom: 0; }
    .quota, .grid.two, .grid.three { grid-template-columns: 1fr; }
  }
  @media (max-width: 480px) {
    .page-heading { flex-direction: column; }
    .state-row { align-items: flex-start; flex-direction: column; }
  }
</style>
