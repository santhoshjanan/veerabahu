<script lang="ts">
  import '$lib/design/tokens.css';
  import { onMount, setContext } from 'svelte';
  import { page } from '$app/stores';
  import { createEventStream } from '$lib/client/sse';
  import SseStatus from '$lib/components/SseStatus.svelte';
  import { formatCount } from '$lib/format';

  let { children, data } = $props();

  const sse = createEventStream();
  setContext('vb:sse', sse);
  const { status } = sse;

  onMount(() => () => sse.close());

  const nav = [
    { href: '/', label: 'Log' },
    { href: '/queue', label: 'Queue' },
    { href: '/review', label: 'Review' },
    { href: '/domains', label: 'Domains' },
    { href: '/audit', label: 'Audit' }
  ];
</script>

<div class="shell">
  <nav class="bar">
    <span class="brand">VEERABAHU</span>
    <ul>
      {#each nav as n (n.href)}
        <li>
          <a href={n.href} aria-current={$page.url.pathname === n.href ? 'page' : undefined}>
            {n.label}
            {#if n.href === '/review' && data.badge.inQueue > 0}
              <span class="badge">{formatCount(data.badge.inQueue)}</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
    <SseStatus state={$status} />
  </nav>
  <main>{@render children()}</main>
</div>

<style>
  .shell {
    min-height: 100vh;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--vb-s5);
    padding: var(--vb-s3) var(--vb-s5);
    border-bottom: 2px solid var(--vb-rule-strong);
    background: var(--vb-ground-raised);
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .brand {
    font: 700 var(--vb-fs-h3) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    letter-spacing: 0.14em;
  }
  .bar ul {
    display: flex;
    gap: var(--vb-s4);
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
  }
  .bar a {
    color: var(--vb-ink-soft);
    text-decoration: none;
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 2px;
  }
  .bar a[aria-current='page'] {
    color: var(--vb-ink);
    border-bottom: 2px solid var(--vb-accent);
  }
  .badge {
    background: var(--vb-accent);
    color: var(--vb-accent-ink);
    border-radius: 999px;
    font-size: 10px;
    padding: 1px 6px;
  }
  main {
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--vb-s6) var(--vb-s5);
  }
  @media (max-width: 720px) {
    .bar {
      flex-wrap: wrap;
      gap: var(--vb-s3);
    }
    main {
      padding: var(--vb-s5) var(--vb-s4);
    }
  }
</style>
