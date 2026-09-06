<script lang="ts">
  import { page } from '$app/stores';

  let { form } = $props();
</script>

<svelte:head>
  <title>Sign in — Veerabahu</title>
</svelte:head>

<section class="login" aria-labelledby="login-title">
  <header>
    <span class="brand">VEERABAHU</span>
    <h1 id="login-title">Unlock the disposition log</h1>
    <p>Enter the local administrator password for this instance.</p>
  </header>

  {#if $page.url.searchParams.has('changed')}
    <p class="notice" role="status">Password changed. Sign in with the new password.</p>
  {:else if $page.url.searchParams.has('signedout')}
    <p class="notice" role="status">You are signed out.</p>
  {/if}

  <form method="POST">
    <label for="password">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
      aria-invalid={form?.invalid ? 'true' : undefined}
      aria-describedby={form?.invalid ? 'login-error' : undefined}
    />
    {#if form?.invalid}
      <p id="login-error" class="error" role="alert">
        That password did not match. Try again.
      </p>
    {/if}
    <button type="submit">Sign in</button>
  </form>
</section>

<style>
  .login {
    width: min(100%, 480px);
    margin: clamp(var(--vb-s5), 10vh, 96px) auto 0;
    border-top: 2px solid var(--vb-rule-strong);
  }
  header {
    padding: var(--vb-s4) 0 var(--vb-s5);
    border-bottom: var(--vb-line);
  }
  .brand {
    font: 700 var(--vb-fs-small) / 1 var(--vb-font-mono);
    letter-spacing: 0.14em;
    color: var(--vb-accent);
  }
  h1 {
    margin: var(--vb-s4) 0 var(--vb-s2);
    font: 700 var(--vb-fs-h1) / 1.15 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    letter-spacing: -0.02em;
  }
  header p {
    margin: 0;
    color: var(--vb-ink-soft);
  }
  form {
    display: grid;
    gap: var(--vb-s3);
    padding-top: var(--vb-s5);
  }
  .notice {
    margin: var(--vb-s4) 0 0;
    padding: var(--vb-s3);
    border: 1px solid var(--vb-success);
    background: var(--vb-ground-raised);
  }
  label {
    font: 600 var(--vb-fs-small) / 1 var(--vb-font-sans);
  }
  input,
  button {
    min-height: 42px;
    border-radius: var(--vb-radius);
    font: inherit;
  }
  input {
    width: 100%;
    border: 1px solid var(--vb-rule-strong);
    background: var(--vb-ground-raised);
    color: var(--vb-ink);
    padding: var(--vb-s2) var(--vb-s3);
  }
  input:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--vb-st-pending_review);
    outline-offset: 2px;
  }
  input[aria-invalid='true'] {
    border-color: var(--vb-accent);
  }
  .error {
    margin: 0;
    color: var(--vb-accent);
    font-size: var(--vb-fs-small);
  }
  button {
    justify-self: start;
    border: 0;
    background: var(--vb-accent);
    color: var(--vb-accent-ink);
    padding: var(--vb-s2) var(--vb-s5);
    font-weight: 700;
    cursor: pointer;
  }
  button:hover {
    filter: brightness(0.94);
  }
</style>
