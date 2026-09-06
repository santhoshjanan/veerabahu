<script lang="ts">
  import SecretField from '$lib/components/SecretField.svelte';
  import SettingsSection from '$lib/components/SettingsSection.svelte';

  let { data, form }: { data: any; form: any } = $props();
  let selectedStep = $state<number | null>(null);
  const step = $derived(selectedStep ?? form?.nextStep ?? form?.step ?? data.step);
  const settings = $derived(data.settings);
  const sourceNames = [
    ['curated_list', 'Curated lists', 'curatedList'],
    ['metadefender', 'MetaDefender', 'metadefender'],
    ['ai', 'AI provider', 'ai'],
    ['virustotal', 'VirusTotal', 'virustotal']
  ] as const;
  const testMessages: Record<string, string> = {
    connected: 'Connected. Gatekeeper read access is working.',
    auth_rejected: 'Authentication rejected. Check the credential and try again.',
    unreachable: 'Gatekeeper unreachable. Check the URL and network.',
    invalid_response: 'Gatekeeper returned an unexpected response.'
  };

  const submitted = (name: string, fallback: unknown = '') =>
    form?.values && name in form.values ? form.values[name] : (fallback ?? '');
  const sourceSubmitted = (name: string, fallback: boolean) =>
    form?.step === 3 && form?.values
      ? Boolean(form.values[name])
      : fallback;
  const errorFor = (name: string) => form?.errors?.[name] as string | undefined;
  const errorId = (name: string) => (errorFor(name) ? `${name}-error` : undefined);
  const limit = (value: number | null | undefined) => value ?? 'No ceiling';
  const pageError = $derived(
    form?.error ?? (step === 5 ? Object.values(form?.errors ?? {})[0] : undefined)
  );
</script>

{#snippet fieldError(name: string)}
  {#if errorFor(name)}<small id={`${name}-error`} class="field-error">{errorFor(name)}</small>{/if}
{/snippet}

<svelte:head>
  <title>Setup — Veerabahu</title>
</svelte:head>

<div class="setup">
  <header class="masthead">
    <h1>VEERABAHU</h1>
    <p>Required first-run configuration</p>
  </header>

  <ol class="steps" aria-label="Setup progress">
    {#each ['Secure access', 'Gatekeeper', 'Sources', 'Quota & scoring', 'Activate'] as label, index}
      <li aria-current={step === index + 1 ? 'step' : undefined} class:done={step > index + 1}>
        <span>{index + 1}</span>{label}
      </li>
    {/each}
  </ol>

  {#if form?.testStatus === 'connected'}
    <p class="notice" role="status">{testMessages.connected}</p>
  {/if}
  {#if pageError}
    <p class="notice error" role="alert">{pageError}</p>
  {/if}
  {#if step === 1}
    <SettingsSection
      title="Secure access"
      description="Create the password for the single local administrator."
    >
      {#if settings?.onboardingStep >= 1}
        <p class="configured">Secure access is configured.</p>
        <button type="button" onclick={() => (selectedStep = 2)}>Continue</button>
      {:else}
        <form method="POST" action="?/access">
          <SecretField name="password" label="Password" autocomplete="new-password" error={errorFor('password')} />
          <SecretField
            name="passwordConfirm"
            label="Confirm password"
            autocomplete="new-password"
            error={errorFor('passwordConfirm')}
          />
          <p class="hint">Use at least 12 characters. There is no remote password reset.</p>
          <button type="submit">Continue</button>
        </form>
      {/if}
    </SettingsSection>
  {:else if step === 2}
    <SettingsSection
      title="Gatekeeper"
      description="Veerabahu needs read-only query-log access. It never changes gatekeeper rules."
    >
      <form method="POST" action="?/gatekeeper">
        <label>
          <span>Gatekeeper</span>
          <select name="type" value={submitted('type', settings?.gatekeeper?.type ?? 'pihole')} aria-invalid={errorFor('type') ? 'true' : undefined} aria-describedby={errorId('type')}>
            <option value="pihole">Pi-hole</option>
            <option value="adguard">AdGuard Home</option>
          </select>
          {@render fieldError('type')}
        </label>
        <label>
          <span>Gatekeeper URL</span>
          <input
            name="baseUrl"
            type="url"
            required
            value={submitted('baseUrl', settings?.gatekeeper?.baseUrl)}
            placeholder="http://pi.hole"
            aria-invalid={errorFor('baseUrl') ? 'true' : undefined}
            aria-describedby={[errorId('baseUrl'), form?.testStatus ? 'gatekeeper-test-status' : ''].filter(Boolean).join(' ') || undefined}
          />
          {@render fieldError('baseUrl')}
        </label>
        <label>
          <span>Username <small>(AdGuard only)</small></span>
          <input name="username" value={submitted('username', settings?.gatekeeper?.username)} aria-invalid={errorFor('username') ? 'true' : undefined} aria-describedby={errorId('username')} />
          {@render fieldError('username')}
        </label>
        <SecretField
          name="password"
          label="Password"
          configured={settings?.gatekeeper?.secretConfigured}
          error={errorFor('password')}
          describedby={form?.testStatus ? 'gatekeeper-test-status' : undefined}
        />
        {#if form?.testStatus}
          <p id="gatekeeper-test-status" class:failure={form.testStatus !== 'connected'} class="connection" role="status">
            {testMessages[form.testStatus]}
          </p>
        {/if}
        <div class="actions">
          <button class="secondary" type="button" onclick={() => (selectedStep = 1)}>Back</button>
          <button type="submit">Test and continue</button>
        </div>
      </form>
    </SettingsSection>
  {:else if step === 3}
    <SettingsSection
      title="Reputation sources"
      description="Keep the local curated source enabled, then opt into only the services you use."
    >
      <form method="POST" action="?/sources">
        <fieldset>
          <legend>Curated lists</legend>
          <label class="check">
            <input
              name="curatedListEnabled"
              type="checkbox"
              checked={sourceSubmitted('curatedListEnabled', settings?.sources.curated_list.enabled ?? true)}
              aria-invalid={errorFor('curatedListEnabled') ? 'true' : undefined}
              aria-describedby={errorId('curatedListEnabled')}
            />
            Enabled
          </label>
          {@render fieldError('curatedListEnabled')}
          <label>
            <span>List URLs <small>(one per line)</small></span>
            <textarea name="curatedListUrls" rows="3" aria-invalid={errorFor('curatedListUrls') ? 'true' : undefined} aria-describedby={errorId('curatedListUrls')}>{submitted('curatedListUrls', settings?.curatedListUrls?.join('\n'))}</textarea>
            {@render fieldError('curatedListUrls')}
          </label>
        </fieldset>

        <fieldset>
          <legend>MetaDefender</legend>
          <label class="check"><input name="metadefenderEnabled" type="checkbox" checked={sourceSubmitted('metadefenderEnabled', settings?.sources.metadefender.enabled ?? false)} /> Enabled</label>
          <label><span>Endpoint</span><input name="metadefenderBaseUrl" type="url" value={submitted('metadefenderBaseUrl', settings?.sources.metadefender.baseUrl)} aria-invalid={errorFor('metadefenderBaseUrl') ? 'true' : undefined} aria-describedby={errorId('metadefenderBaseUrl')} />{@render fieldError('metadefenderBaseUrl')}</label>
          <SecretField name="metadefenderApiKey" label="API key" configured={settings?.sources.metadefender.secretConfigured} error={errorFor('metadefenderApiKey')} />
        </fieldset>

        <fieldset>
          <legend>AI provider</legend>
          <label class="check"><input name="aiEnabled" type="checkbox" checked={sourceSubmitted('aiEnabled', settings?.sources.ai.enabled ?? false)} /> Enabled</label>
          <label><span>Endpoint</span><input name="aiBaseUrl" type="url" value={submitted('aiBaseUrl', settings?.sources.ai.baseUrl)} aria-invalid={errorFor('aiBaseUrl') ? 'true' : undefined} aria-describedby={errorId('aiBaseUrl')} />{@render fieldError('aiBaseUrl')}</label>
          <label><span>Model</span><input name="aiModel" value={submitted('aiModel', settings?.sources.ai.model)} aria-invalid={errorFor('aiModel') ? 'true' : undefined} aria-describedby={errorId('aiModel')} />{@render fieldError('aiModel')}</label>
          <SecretField name="aiApiKey" label="API key" configured={settings?.sources.ai.secretConfigured} error={errorFor('aiApiKey')} />
        </fieldset>

        <fieldset>
          <legend>VirusTotal</legend>
          <label class="check"><input name="virustotalEnabled" type="checkbox" checked={sourceSubmitted('virustotalEnabled', settings?.sources.virustotal.enabled ?? false)} /> Enabled</label>
          <label><span>Endpoint</span><input name="virustotalBaseUrl" type="url" value={submitted('virustotalBaseUrl', settings?.sources.virustotal.baseUrl)} aria-invalid={errorFor('virustotalBaseUrl') ? 'true' : undefined} aria-describedby={errorId('virustotalBaseUrl')} />{@render fieldError('virustotalBaseUrl')}</label>
          <SecretField name="virustotalApiKey" label="API key" configured={settings?.sources.virustotal.secretConfigured} error={errorFor('virustotalApiKey')} />
        </fieldset>

        <div class="actions">
          <button class="secondary" type="button" onclick={() => (selectedStep = 2)}>Back</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </SettingsSection>
  {:else if step === 4}
    <SettingsSection
      title="Quota and scoring"
      description="Blank quota fields mean no ceiling. Weights control each enabled source's vote."
    >
      <form method="POST" action="?/quotas">
        {#each sourceNames as [source, label, prefix]}
          <fieldset class="quota">
            <legend>{label}</legend>
            {#each [['PerMinute', 'Per minute'], ['PerDay', 'Per day'], ['PerMonth', 'Per month']] as [suffix, labelText]}
              <label><span>{labelText}</span><input name={`${prefix}${suffix}`} type="number" min="0" step="any" value={submitted(`${prefix}${suffix}`, settings?.quotas[source][`per${suffix.slice(3)}`])} aria-invalid={errorFor(`${prefix}${suffix}`) ? 'true' : undefined} aria-describedby={errorId(`${prefix}${suffix}`)} />{@render fieldError(`${prefix}${suffix}`)}</label>
            {/each}
            <label><span>Weight</span><input name={`${prefix}Weight`} type="number" min="0" step="any" required value={submitted(`${prefix}Weight`, settings?.weights[source])} aria-invalid={errorFor(`${prefix}Weight`) ? 'true' : undefined} aria-describedby={errorId(`${prefix}Weight`)} />{@render fieldError(`${prefix}Weight`)}</label>
          </fieldset>
        {/each}
        <fieldset>
          <legend>AI cost</legend>
          <div class="grid">
            <label><span>Daily ceiling (USD)</span><input name="aiDailyCostCeilingUsd" type="number" min="0" step="any" value={submitted('aiDailyCostCeilingUsd', settings?.quotas.ai.dailyCostCeilingUsd)} aria-invalid={errorFor('aiDailyCostCeilingUsd') ? 'true' : undefined} aria-describedby={errorId('aiDailyCostCeilingUsd')} />{@render fieldError('aiDailyCostCeilingUsd')}</label>
            <label><span>Input / million tokens</span><input name="aiPriceInputPerMTok" type="number" min="0" step="any" value={submitted('aiPriceInputPerMTok', settings?.sources.ai.priceInputPerMTok)} aria-invalid={errorFor('aiPriceInputPerMTok') ? 'true' : undefined} aria-describedby={errorId('aiPriceInputPerMTok')} />{@render fieldError('aiPriceInputPerMTok')}</label>
            <label><span>Output / million tokens</span><input name="aiPriceOutputPerMTok" type="number" min="0" step="any" value={submitted('aiPriceOutputPerMTok', settings?.sources.ai.priceOutputPerMTok)} aria-invalid={errorFor('aiPriceOutputPerMTok') ? 'true' : undefined} aria-describedby={errorId('aiPriceOutputPerMTok')} />{@render fieldError('aiPriceOutputPerMTok')}</label>
          </div>
        </fieldset>
        <div class="actions">
          <button class="secondary" type="button" onclick={() => (selectedStep = 3)}>Back</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </SettingsSection>
  {:else}
    <SettingsSection
      title="Review and activate"
      description="The scheduler remains stopped until you activate this configuration."
    >
      <dl>
        <div><dt>Gatekeeper</dt><dd>{settings?.gatekeeper?.type} at {settings?.gatekeeper?.baseUrl}</dd></div>
        {#if settings?.gatekeeper?.type === 'adguard'}
          <div><dt>Username</dt><dd>{settings.gatekeeper.username ?? 'Not configured'}</dd></div>
        {/if}
        <div><dt>Credential</dt><dd>{settings?.gatekeeper?.secretConfigured ? 'Configured ••••••••' : 'Missing'}</dd></div>
      </dl>
      <div class="table-scroll">
        <table>
          <caption>Reputation sources</caption>
          <thead><tr><th>Source</th><th>State</th><th>Endpoint</th><th>Credential</th><th>Min / day / month</th><th>Weight</th></tr></thead>
          <tbody>
            {#each sourceNames as [source, label]}
              <tr>
                <th>{label}</th>
                <td>{settings?.sources[source].enabled ? 'Enabled' : 'Disabled'}</td>
                <td>{source === 'curated_list' ? 'Local' : settings?.sources[source].baseUrl ?? 'Not configured'}</td>
                <td>{source === 'curated_list' ? 'Not required' : settings?.sources[source].secretConfigured ? 'Configured ••••••••' : 'Not configured'}</td>
                <td>{limit(settings?.quotas[source].perMinute)} / {limit(settings?.quotas[source].perDay)} / {limit(settings?.quotas[source].perMonth)}</td>
                <td>{settings?.weights[source]}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <dl>
        <div><dt>AI model</dt><dd>{settings?.sources.ai.model ?? 'Not configured'}</dd></div>
        <div><dt>AI input price</dt><dd>{limit(settings?.sources.ai.priceInputPerMTok)} USD / million tokens</dd></div>
        <div><dt>AI output price</dt><dd>{limit(settings?.sources.ai.priceOutputPerMTok)} USD / million tokens</dd></div>
        <div><dt>AI daily cost</dt><dd>{limit(settings?.quotas.ai.dailyCostCeilingUsd)} USD</dd></div>
        <div><dt>Curated list URLs</dt><dd>{settings?.curatedListUrls.length ? settings.curatedListUrls.join(', ') : 'Built-in lists only'}</dd></div>
      </dl>
      <aside>
        <strong>Gatekeeper pull required</strong>
        <p>Add <code>{settings?.scheduler.blocklistPath ?? '/blocklist.txt'}</code> as a blocklist in your gatekeeper and refresh it roughly every hour.</p>
      </aside>
      <form method="POST" action="?/activate">
        <div class="actions">
          <button class="secondary" type="button" onclick={() => (selectedStep = 4)}>Back</button>
          <button type="submit">Activate</button>
        </div>
      </form>
    </SettingsSection>
  {/if}
</div>

<style>
  .setup { width: min(100%, 860px); margin: 0 auto; }
  .masthead { display: flex; justify-content: space-between; gap: var(--vb-s4); padding-bottom: var(--vb-s4); }
  .masthead h1 { margin: 0; font: 700 var(--vb-fs-h3) / 1 var(--vb-font-head); letter-spacing: .14em; }
  .masthead p { margin: 0; color: var(--vb-ink-soft); }
  .steps { display: grid; grid-template-columns: repeat(5, 1fr); list-style: none; margin: 0 0 var(--vb-s5); padding: 0; border: var(--vb-line); background: var(--vb-ground-sunk); }
  .steps li { display: flex; gap: var(--vb-s2); align-items: center; padding: var(--vb-s3); color: var(--vb-ink-faint); font-size: var(--vb-fs-small); border-right: var(--vb-line); }
  .steps li:last-child { border-right: 0; }
  .steps li[aria-current='step'] { color: var(--vb-ink); background: var(--vb-ground-raised); font-weight: 700; }
  .steps li.done { color: var(--vb-success); }
  .steps span { font: 700 var(--vb-fs-micro) / 1 var(--vb-font-mono); }
  .notice { border: 1px solid var(--vb-success); margin: 0 0 var(--vb-s4); padding: var(--vb-s3); background: var(--vb-ground-raised); }
  .notice.error { border-color: var(--vb-danger); color: var(--vb-danger); }
  .connection { margin: 0; color: var(--vb-success); font-size: var(--vb-fs-small); }
  .connection.failure, .field-error { color: var(--vb-danger); }
  .field-error { font-weight: 400; }
  form { display: grid; gap: var(--vb-s4); }
  label { display: grid; gap: var(--vb-s1); font-weight: 600; }
  label small { color: var(--vb-ink-soft); font-weight: 400; }
  input, select, textarea, button { font: inherit; }
  input:not([type='checkbox']), select, textarea { width: 100%; min-height: 42px; border: 1px solid var(--vb-rule-strong); border-radius: var(--vb-radius); padding: var(--vb-s2) var(--vb-s3); background: var(--vb-ground-raised); color: var(--vb-ink); }
  input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 3px solid var(--vb-st-pending_review); outline-offset: 2px; }
  textarea { resize: vertical; }
  fieldset { display: grid; gap: var(--vb-s3); margin: 0; padding: var(--vb-s4); border: var(--vb-line); }
  legend { padding: 0 var(--vb-s2); font: 700 var(--vb-fs-small) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: .06em; }
  .check { display: flex; align-items: center; gap: var(--vb-s2); }
  .hint { margin: 0; color: var(--vb-ink-soft); font-size: var(--vb-fs-small); }
  .configured { color: var(--vb-success); }
  .actions { display: flex; justify-content: space-between; gap: var(--vb-s3); margin-top: var(--vb-s2); }
  button { min-height: 42px; border: 0; border-radius: var(--vb-radius); padding: var(--vb-s2) var(--vb-s5); background: var(--vb-accent); color: var(--vb-accent-ink); font-weight: 700; cursor: pointer; }
  button.secondary { border: 1px solid var(--vb-rule-strong); background: transparent; color: var(--vb-ink); }
  .quota { grid-template-columns: repeat(4, 1fr); }
  .quota legend { float: left; width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--vb-s3); }
  dl { margin: 0; }
  dl div { display: grid; grid-template-columns: 140px 1fr; gap: var(--vb-s3); padding: var(--vb-s3) 0; border-bottom: var(--vb-line); }
  dt { color: var(--vb-ink-soft); }
  dd { margin: 0; }
  .table-scroll { overflow-x: auto; margin-top: var(--vb-s5); }
  table { width: 100%; border-collapse: collapse; font-size: var(--vb-fs-small); }
  caption { padding-bottom: var(--vb-s2); text-align: left; font-weight: 700; }
  th, td { padding: var(--vb-s2); border-bottom: var(--vb-line); text-align: left; vertical-align: top; }
  td:nth-child(n + 5) { font-variant-numeric: tabular-nums; }
  aside { margin: var(--vb-s5) 0; padding: var(--vb-s4); border: 1px solid var(--vb-st-pending_review); background: var(--vb-ground-sunk); }
  aside p { margin: var(--vb-s2) 0 0; }
  code { font-family: var(--vb-font-mono); }
  @media (max-width: 720px) {
    .steps { grid-template-columns: 1fr; }
    .steps li { border-right: 0; border-bottom: var(--vb-line); }
    .steps li:not([aria-current='step']) { display: none; }
    .quota, .grid { grid-template-columns: 1fr; }
  }
</style>
