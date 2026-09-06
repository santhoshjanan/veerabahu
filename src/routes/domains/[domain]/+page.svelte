<script lang="ts">
  import DomainRecord from '$lib/components/DomainRecord.svelte';
  let { data } = $props();
</script>

<a class="back" href="/domains">← Domain log</a>
<DomainRecord detail={data.detail} />

<style>
  .back {
    display: inline-block;
    margin-bottom: var(--vb-s4);
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
    color: var(--vb-accent);
    text-decoration: none;
  }
</style>
