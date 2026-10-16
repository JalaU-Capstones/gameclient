<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ApiError } from '$lib/api/errors';
  import { logsApi } from '$lib/api/logs';
  import type { LogEntry } from '$lib/types/api';
  import { sounds } from '$lib/audio/sounds';
  import { userFacingMessage } from '$lib/errors/messages';
  import {
    filterLogEntries,
    LOG_FILTER_LABELS,
    LOG_FILTERS,
    summarizeMessage,
    type LogFilter
  } from '$lib/utils/logFilter';

  const PAGE_SIZE = 20;

  let items = $state<LogEntry[]>([]);
  let total = $state(0);
  let limit = $state(PAGE_SIZE);
  let offset = $state(0);
  let isLoading = $state(true);
  let error = $state('');
  let filter = $state<LogFilter>('all');
  const expandedIds = new SvelteSet<string>();

  const filteredItems = $derived(filterLogEntries(items, filter));
  const page = $derived(Math.floor(offset / limit) + 1);
  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
  const canGoPrev = $derived(offset > 0 && filteredItems.length > 0);
  const canGoNext = $derived(offset + limit < total && filteredItems.length > 0);
  const rangeStart = $derived(total === 0 ? 0 : offset + 1);
  const rangeEnd = $derived(Math.min(offset + items.length, total));

  const levelClasses: Record<string, string> = {
    debug: 'border-[var(--text-muted)] text-[var(--text-muted)]',
    info: 'border-[var(--neon-cyan)] text-[var(--neon-cyan)] shadow-[var(--glow-cyan)]',
    warning:
      'border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-400 dark:shadow-[0_0_8px_rgba(251,191,36,0.35)]',
    error: 'border-[var(--neon-magenta)] text-[var(--neon-magenta)] shadow-[var(--glow-magenta)]',
    critical: 'border-red-500 text-red-500 shadow-[0_0_8px_rgba(248,113,113,0.4)]'
  };

  function formatTimestamp(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(new Date(iso));
  }

  function formatEventType(eventType: string): string {
    return eventType.replace(/_/g, ' ');
  }

  function formatMetadata(metadata: Record<string, unknown> | null): string {
    if (!metadata || Object.keys(metadata).length === 0) return 'No metadata';
    try {
      return JSON.stringify(metadata, null, 2);
    } catch {
      return String(metadata);
    }
  }

  function isExpanded(id: string): boolean {
    return expandedIds.has(id);
  }

  function toggleExpanded(id: string) {
    sounds.play('click');
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
  }

  function setFilter(next: LogFilter) {
    if (filter === next) return;
    sounds.play('click');
    filter = next;
    expandedIds.clear();
  }

  async function loadPage(nextOffset: number) {
    isLoading = true;
    error = '';
    try {
      const pageData = await logsApi.listMine({ limit: PAGE_SIZE, offset: nextOffset });
      items = pageData.items;
      total = pageData.total;
      limit = pageData.limit;
      offset = pageData.offset;
      expandedIds.clear();
    } catch (err) {
      error = userFacingMessage(err instanceof ApiError ? err.code : undefined);
      items = [];
      total = 0;
    } finally {
      isLoading = false;
    }
  }

  function goPrev() {
    if (!canGoPrev || isLoading) return;
    sounds.play('click');
    void loadPage(Math.max(0, offset - limit));
  }

  function goNext() {
    if (!canGoNext || isLoading) return;
    sounds.play('click');
    void loadPage(offset + limit);
  }

  onMount(() => {
    void loadPage(0);
  });
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-[var(--neon-cyan)]">Logs</h2>

  <div
    class="bg-[var(--cell)] rounded-xl border border-[var(--neon-cyan)] p-6 shadow-[var(--glow-cyan)] space-y-6"
  >
    <div class="border-b border-[var(--neon-cyan)] pb-4 space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 class="text-2xl font-bold text-[var(--text-primary)]">Your activity</h3>
          <p class="text-sm text-[var(--text-muted)] mt-1">
            Server events for your account. Expand a row for full details.
          </p>
        </div>
        {#if !isLoading && total > 0}
          <p class="text-sm text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">
            {rangeStart}–{rangeEnd} of {total}
          </p>
        {/if}
      </div>

      <div class="flex flex-wrap gap-2" role="group" aria-label="Filter logs by level">
        {#each LOG_FILTERS as option (option)}
          <button
            type="button"
            class="px-4 py-1.5 uppercase tracking-widest text-xs rounded-full border transition active:scale-95
              {filter === option
              ? 'border-[var(--neon-magenta)] bg-[var(--neon-magenta)] text-[var(--bg)] shadow-[var(--glow-magenta)]'
              : 'border-[var(--text-muted)] text-[var(--text-muted)] hover:border-[var(--neon-cyan)] hover:text-[var(--neon-cyan)]'}"
            aria-pressed={filter === option}
            onclick={() => setFilter(option)}
          >
            {LOG_FILTER_LABELS[option]}
          </button>
        {/each}
      </div>
    </div>

    {#if isLoading}
      <p class="text-[var(--text-muted)] text-center py-8 text-xl">Loading logs...</p>
    {:else if error}
      <div
        class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center"
      >
        {error}
      </div>
    {:else if items.length === 0}
      <p class="font-(family-name:--font-title) text-[var(--text-muted)] text-center py-8">
        No logs yet.
      </p>
    {:else if filteredItems.length === 0}
      <p class="text-[var(--text-muted)] text-center py-8 text-lg">
        No {LOG_FILTER_LABELS[filter].toLowerCase()} logs on this page.
      </p>
    {:else}
      <ul class="space-y-3">
        {#each filteredItems as entry (entry.id)}
          <li
            class="bg-[var(--bg)] border border-[var(--neon-cyan)]/30 rounded-lg hover:border-[var(--neon-cyan)] transition"
          >
            <button
              type="button"
              class="w-full text-left p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between cursor-pointer"
              aria-expanded={isExpanded(entry.id)}
              onclick={() => toggleExpanded(entry.id)}
            >
              <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="px-3 py-1 uppercase tracking-widest text-xs rounded-full border whitespace-nowrap {levelClasses[
                      entry.level
                    ] ?? levelClasses.info}"
                  >
                    {entry.level}
                  </span>
                  <span class="text-sm font-mono text-[var(--text-primary)] truncate">
                    {formatEventType(entry.eventType)}
                  </span>
                </div>
                <p class="text-[var(--text-muted)] text-sm leading-relaxed">
                  {summarizeMessage(entry.message)}
                </p>
                <p class="text-xs text-[var(--text-muted)]">{formatTimestamp(entry.timestamp)}</p>
              </div>
              <span
                class="self-start sm:self-center text-xs uppercase tracking-widest text-[var(--neon-cyan)] whitespace-nowrap"
              >
                {isExpanded(entry.id) ? 'Hide details' : 'Details'}
              </span>
            </button>

            {#if isExpanded(entry.id)}
              <div
                class="border-t border-[var(--neon-cyan)]/20 px-4 pb-4 pt-3 space-y-3 text-sm"
                data-testid="log-details"
              >
                <div>
                  <p class="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">
                    Full message
                  </p>
                  <p class="text-[var(--text-primary)] whitespace-pre-wrap break-words">
                    {entry.message}
                  </p>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p class="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">
                      Gameplay
                    </p>
                    <p class="font-mono text-xs break-all text-[var(--text-primary)]">
                      {entry.gameplayId ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">
                      Player
                    </p>
                    <p class="font-mono text-xs break-all text-[var(--text-primary)]">
                      {entry.playerId ?? '—'}
                    </p>
                  </div>
                </div>
                <div>
                  <p class="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">
                    Metadata
                  </p>
                  <pre
                    class="overflow-x-auto rounded-lg border border-[var(--neon-cyan)]/20 bg-[var(--cell)] p-3 text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words">{formatMetadata(
                      entry.metadata
                    )}</pre>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if !isLoading && total > 0}
      <div
        class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-[var(--neon-cyan)]/30"
      >
        <p class="text-sm text-[var(--text-muted)] uppercase tracking-widest">
          Page {page} / {totalPages}
          {#if filter !== 'all'}
            · {filteredItems.length} shown after filter
          {/if}
        </p>
        <div class="flex gap-3">
          <button
            type="button"
            class="px-5 py-2 uppercase tracking-widest text-xs rounded-full border border-[var(--neon-cyan)] text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--neon-cyan)]"
            disabled={!canGoPrev}
            onclick={goPrev}
          >
            Previous
          </button>
          <button
            type="button"
            class="px-5 py-2 uppercase tracking-widest text-xs rounded-full border border-[var(--neon-cyan)] text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--neon-cyan)]"
            disabled={!canGoNext}
            onclick={goNext}
          >
            Next
          </button>
        </div>
      </div>
    {/if}
  </div>
</section>
