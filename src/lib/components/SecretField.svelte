<script lang="ts">
  let {
    name,
    label,
    configured = false,
    autocomplete = 'off'
  }: {
    name: string;
    label: string;
    configured?: boolean;
    autocomplete?: 'off' | 'new-password' | 'current-password';
  } = $props();
</script>

<label class="field">
  <span>{label}</span>
  <input {name} type="password" {autocomplete} />
  {#if configured}
    <small>Configured — leave blank to keep it</small>
  {/if}
</label>

<style>
  .field {
    display: grid;
    gap: var(--vb-s1);
  }
  span {
    font-weight: 600;
  }
  input {
    min-height: 42px;
    width: 100%;
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    padding: var(--vb-s2) var(--vb-s3);
    background: var(--vb-ground-raised);
    color: var(--vb-ink);
    font: inherit;
  }
  input:focus-visible {
    outline: 3px solid var(--vb-st-pending_review);
    outline-offset: 2px;
  }
  small {
    color: var(--vb-success);
  }
</style>
