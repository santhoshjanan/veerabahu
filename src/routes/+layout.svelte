<script lang="ts">
  import '$lib/design/tokens.css';
  import { onMount, setContext } from 'svelte';
  import { preloadData, pushState } from '$app/navigation';
  import { page } from '$app/stores';
  import { createEventStream } from '$lib/client/sse';
  import SseStatus from '$lib/components/SseStatus.svelte';
  import { formatCount } from '$lib/format';
  import Sheet from '$lib/components/Sheet.svelte';
  import DomainRecord from '$lib/components/DomainRecord.svelte';
  import type { ReviewDetail } from '$lib/server/pipeline/review';

  let { children, data } = $props();

  const sse = createEventStream();
  setContext('vb:sse', sse);
  const { status } = sse;
  let sheetDomain = $state<string | null>(null);
  let sheetOpen = $state(false);
  let sheetDetail = $state<ReviewDetail | null>(null);

  const detailPath = (pathname: string) => {
    const match = /^\/domains\/([^/]+)$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  };

  async function refreshDetail(domain = sheetDomain) {
    if (!domain) return;
    const result = await preloadData(`/domains/${encodeURIComponent(domain)}`);
    if (result.type === 'loaded' && result.status === 200 && sheetDomain === domain) {
      sheetDetail = result.data.detail;
    }
  }

  async function openDomainSheet(event: MouseEvent) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/domains/"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const domain = detailPath(link.pathname);
    if (!domain) return;
    event.preventDefault();
    const result = await preloadData(link.href);
    if (result.type !== 'loaded' || result.status !== 200) return;
    sheetDomain = domain;
    sheetDetail = result.data.detail;
    sheetOpen = true;
    pushState(link.pathname, { sheet: { domain } });
  }

  function closeDomainSheet() {
    if (sheetDomain) history.back();
  }

  $effect(() => {
    const fromHistory = $page.state?.sheet?.domain;
    if (fromHistory) {
      if (sheetDomain !== fromHistory) {
        sheetDomain = fromHistory;
        sheetDetail = null;
        void refreshDetail(fromHistory);
      }
      sheetOpen = true;
    } else if (!detailPath($page.url.pathname)) {
      sheetDomain = null;
      sheetDetail = null;
      sheetOpen = false;
    }
  });

  onMount(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshDetail();
    }, 20_000);
    return () => {
      clearInterval(id);
      sse.close();
    };
  });

  const nav = [
    { href: '/', label: 'Log' },
    { href: '/queue', label: 'Queue' },
    { href: '/review', label: 'Review' },
    { href: '/domains', label: 'Domains' },
    { href: '/audit', label: 'Audit' }
  ];
</script>

<svelte:window onclick={openDomainSheet} />

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
  {#if sheetOpen && sheetDetail}
    <Sheet bind:open={sheetOpen} title={sheetDetail.domain} onclose={closeDomainSheet}>
      <DomainRecord detail={sheetDetail} onallowlist={() => void refreshDetail()} />
    </Sheet>
  {/if}
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
