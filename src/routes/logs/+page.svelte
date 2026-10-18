<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ApiError } from '$lib/api/errors';
  import { logsApi, type ListAllLogsParams, type ListLogsParams } from '$lib/api/logs';
  import { config } from '$lib/config';
  import { currentUser } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toasts';
  import type { LogEntry } from '$lib/types/api';
  import { sounds } from '$lib/audio/sounds';
  import { userFacingMessage } from '$lib/errors/messages';
  import StatCard from '$lib/components/charts/StatCard.svelte';
  import BarChart from '$lib/components/charts/BarChart.svelte';
  import PieChart from '$lib/components/charts/PieChart.svelte';
  import HBarChart from '$lib/components/charts/HBarChart.svelte';
  import {
    LOG_FILTER_LABELS,
    LOG_FILTERS,
    summarizeMessage,
    type LogFilter
  } from '$lib/utils/logFilter';
  import {
    activityColorMap,
    aggregateActivity,
    aggregateLevelDistribution,
    aggregateTopEventTypes,
    hasChartData,
    LEVEL_COLORS,
    type ActivityRange
  } from '$lib/utils/logAggregations';
  import { downloadCsv, logsToCsv } from '$lib/utils/csv';

  type LogTab = 'overview' | 'raw';
  type TimeRangeValue = 'all' | '1h' | '6h' | '24h' | '7d';

  const PAGE_SIZE = 20;

  let items = $state<LogEntry[]>([]);
  let total = $state(0);
  let limit = $state(PAGE_SIZE);
  let offset = $state(0);
  let isLoading = $state(true);
  let error = $state('');
  let activeTab = $state<LogTab>('raw');
  let filter = $state<LogFilter>('all');
  let eventTypeFilter = $state('');
  let timeRange = $state<TimeRangeValue>('24h');
  let didFallbackToMine = $state(false);
  let isExporting = $state(false);
  const expandedIds = new SvelteSet<string>();

  const isAdminUser = $derived(
    !!$currentUser && config.logAdminEmails.includes($currentUser.email.trim().toLowerCase())
  );
  const page = $derived(Math.floor(offset / limit) + 1);
  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
  const canGoPrev = $derived(activeTab === 'raw' && offset > 0 && items.length > 0);
  const canGoNext = $derived(activeTab === 'raw' && offset + limit < total && items.length > 0);
  const rangeStart = $derived(total === 0 ? 0 : offset + 1);
  const rangeEnd = $derived(Math.min(offset + items.length, total));
  const chartRange: ActivityRange = $derived(
    // "all" has no fixed width, so the overview charts bucket the latest 24 hours.
    timeRange === 'all' ? '24h' : (timeRange as ActivityRange)
  );
  const activityColumns = $derived(aggregateActivity(items, chartRange, Date.now()));
  const activityColors = $derived(activityColorMap());
  const levelSlices = $derived(aggregateLevelDistribution(items));
  const topEventTypes = $derived(aggregateTopEventTypes(items));
  const hasActivity = $derived(hasChartData(activityColumns));

  void LEVEL_COLORS;

  const levelClasses: Record<string, string> = {
    debug: 'border-fg-muted text-fg-muted',
    info: 'border-neon-cyan text-neon-cyan shadow-glow-cyan',
    warning:
      'border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-400 dark:shadow-[0_0_8px_rgba(251,191,36,0.35)]',
    error: 'border-neon-magenta text-neon-magenta shadow-glow-magenta',
    critical: 'border-red-500 text-red-500 shadow-[0_0_8px_rgba(248,113,113,0.4)]'
  };

  const stats = $derived({
    total: items.length,
    warnings: items.filter((entry) => entry.level === 'warning').length,
    errors: items.filter((entry) => entry.level === 'error' || entry.level === 'critical').length,
    uniquePlayers: new Set(
      items.map((entry) => entry.playerId).filter((playerId): playerId is string => !!playerId)
    ).size,
    uniqueGames: new Set(
      items
        .map((entry) => entry.gameplayId)
        .filter((gameplayId): gameplayId is string => !!gameplayId)
    ).size
  });

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

  function getTimeRangeBounds(range: TimeRangeValue): { from?: string; to?: string } {
    if (range === 'all') return {};

    const to = new Date();
    const offsetMs = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    }[range];

    return {
      from: new Date(to.getTime() - offsetMs).toISOString(),
      to: to.toISOString()
    };
  }

  function buildRequestParams(nextOffset: number): ListLogsParams {
    const params: ListLogsParams = {
      limit: activeTab === 'overview' ? 200 : PAGE_SIZE,
      offset: nextOffset
    };

    if (filter !== 'all') {
      if (filter === 'fail') params.level = 'ERROR';
      else params.level = filter.toUpperCase();
    }

    if (eventTypeFilter.trim()) {
      params.eventType = eventTypeFilter.trim();
    }

    const bounds = getTimeRangeBounds(timeRange);
    if (bounds.from) params.from = bounds.from;
    if (bounds.to) params.to = bounds.to;

    return params;
  }

  async function loadPage(nextOffset: number) {
    isLoading = true;
    error = '';
    const params = buildRequestParams(nextOffset);

    try {
      const pageData = isAdminUser
        ? await logsApi.listAll(params as ListAllLogsParams)
        : await logsApi.listMine(params);

      items = pageData.items;
      total = pageData.total;
      limit = pageData.limit;
      offset = pageData.offset;
      didFallbackToMine = false;
      expandedIds.clear();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && isAdminUser && !didFallbackToMine) {
        didFallbackToMine = true;
        pushToast('warning', 'Admin permissions changed. Showing your own logs.');
        try {
          const pageData = await logsApi.listMine(params);
          items = pageData.items;
          total = pageData.total;
          limit = pageData.limit;
          offset = pageData.offset;
          expandedIds.clear();
          return;
        } catch (fallbackError) {
          error = userFacingMessage(
            fallbackError instanceof ApiError ? fallbackError.code : undefined
          );
          items = [];
          total = 0;
          return;
        }
      }

      error = userFacingMessage(err instanceof ApiError ? err.code : undefined);
      items = [];
      total = 0;
    } finally {
      isLoading = false;
    }
  }

  function setFilter(next: LogFilter) {
    if (filter === next) return;
    sounds.play('click');
    filter = next;
    expandedIds.clear();
    void loadPage(0);
  }

  function setEventType(value: string) {
    eventTypeFilter = value;
    expandedIds.clear();
    void loadPage(0);
  }

  function setTimeRange(next: TimeRangeValue) {
    if (timeRange === next) return;
    timeRange = next;
    expandedIds.clear();
    void loadPage(0);
  }

  async function handleExportCsv() {
    if (items.length === 0 || isExporting) return;
    isExporting = true;
    try {
      const csv = logsToCsv(items);
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, '')
        .replace('T', '-');
      downloadCsv(csv, { filename: `gameapi-logs-${stamp}.csv` });
      sounds.play('click');
    } finally {
      isExporting = false;
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

  function switchTab(nextTab: LogTab) {
    if (activeTab === nextTab) return;
    activeTab = nextTab;
    expandedIds.clear();
    void loadPage(0);
  }

  onMount(() => {
    void loadPage(0);
  });
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-neon-cyan">Logs</h2>

  <div class="bg-cell rounded-xl border border-neon-cyan p-6 shadow-glow-cyan space-y-6">
    <div class="space-y-4 border-b border-neon-cyan pb-4">
      <div class="flex flex-wrap gap-2" role="tablist" aria-label="Logs tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          class={`px-4 py-2 uppercase tracking-widest text-xs rounded-full border transition ${
            activeTab === 'overview'
              ? 'border-neon-magenta bg-neon-magenta text-bg shadow-glow-magenta'
              : 'border-fg-muted text-fg-muted hover:border-neon-cyan hover:text-neon-cyan'
          }`}
          onclick={() => switchTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'raw'}
          class={`px-4 py-2 uppercase tracking-widest text-xs rounded-full border transition ${
            activeTab === 'raw'
              ? 'border-neon-magenta bg-neon-magenta text-bg shadow-glow-magenta'
              : 'border-fg-muted text-fg-muted hover:border-neon-cyan hover:text-neon-cyan'
          }`}
          onclick={() => switchTab('raw')}
        >
          Raw logs
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-3">
        <label class="flex flex-col gap-2 text-xs uppercase tracking-widest text-fg-muted">
          Level
          <div class="flex flex-wrap gap-2" role="group" aria-label="Filter logs by level">
            {#each LOG_FILTERS as option (option)}
              <button
                type="button"
                class="px-3 py-1.5 uppercase tracking-widest text-[10px] rounded-full border transition active:scale-95
                  {filter === option
                  ? 'border-neon-magenta bg-neon-magenta text-bg shadow-glow-magenta'
                  : 'border-fg-muted text-fg-muted hover:border-neon-cyan hover:text-neon-cyan'}"
                aria-pressed={filter === option}
                onclick={() => setFilter(option)}
              >
                {LOG_FILTER_LABELS[option]}
              </button>
            {/each}
          </div>
        </label>

        <label class="flex flex-col gap-2 text-xs uppercase tracking-widest text-fg-muted">
          Event type
          <input
            class="rounded-lg border border-neon-cyan/40 bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-neon-cyan"
            value={eventTypeFilter}
            oninput={(event) => setEventType((event.currentTarget as HTMLInputElement).value)}
            placeholder="event_name"
          />
        </label>

        <label class="flex flex-col gap-2 text-xs uppercase tracking-widest text-fg-muted">
          Time range
          <select
            class="rounded-lg border border-neon-cyan/40 bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-neon-cyan"
            value={timeRange}
            onchange={(event) =>
              setTimeRange((event.currentTarget as HTMLSelectElement).value as TimeRangeValue)}
          >
            <option value="all">All</option>
            <option value="1h">1h</option>
            <option value="6h">6h</option>
            <option value="24h">24h</option>
            <option value="7d">7d</option>
          </select>
        </label>
      </div>
    </div>

    {#if isLoading}
      <p class="text-fg-muted text-center py-8 text-xl">Loading logs...</p>
    {:else if error}
      <div
        class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center"
      >
        {error}
      </div>
    {:else if activeTab === 'overview'}
      <div class="space-y-6">
        <div class="grid gap-4 grid-cols-2 md:grid-cols-5">
          <StatCard label="Total" value={stats.total} accent="cyan" testId="stat-total" />
          <StatCard label="Warnings" value={stats.warnings} accent="amber" testId="stat-warnings" />
          <StatCard label="Errors" value={stats.errors} accent="magenta" testId="stat-errors" />
          <StatCard
            label="Unique players"
            value={stats.uniquePlayers}
            accent="neutral"
            testId="stat-players"
          />
          <StatCard
            label="Unique games"
            value={stats.uniqueGames}
            accent="neutral"
            testId="stat-games"
          />
        </div>

        <p class="text-xs uppercase tracking-widest text-fg-muted">
          Based on the latest {items.length} logs in the selected range.
        </p>

        <div class="grid gap-4 lg:grid-cols-2">
          <div
            class="rounded-xl border border-neon-cyan/40 bg-bg p-4 space-y-3"
            data-testid="chart-activity"
          >
            <h3 class="text-xs uppercase tracking-widest text-fg-muted">Activity over time</h3>
            {#if hasActivity}
              <BarChart
                columns={activityColumns}
                colorMap={activityColors}
                ariaLabel="Activity over time"
              />
            {:else}
              <p class="text-fg-muted text-sm py-6 text-center">No data in range.</p>
            {/if}
          </div>

          <div
            class="rounded-xl border border-neon-cyan/40 bg-bg p-4 space-y-3"
            data-testid="chart-levels"
          >
            <h3 class="text-xs uppercase tracking-widest text-fg-muted">Level distribution</h3>
            {#if levelSlices.length > 0}
              <PieChart slices={levelSlices} ariaLabel="Level distribution" />
            {:else}
              <p class="text-fg-muted text-sm py-6 text-center">No data in range.</p>
            {/if}
          </div>
        </div>

        <div
          class="rounded-xl border border-neon-cyan/40 bg-bg p-4 space-y-3"
          data-testid="chart-events"
        >
          <h3 class="text-xs uppercase tracking-widest text-fg-muted">Top event types</h3>
          {#if topEventTypes.length > 0}
            <HBarChart items={topEventTypes} ariaLabel="Top event types" />
          {:else}
            <p class="text-fg-muted text-sm py-6 text-center">No data in range.</p>
          {/if}
        </div>
      </div>
    {:else if items.length === 0}
      <p class="font-(family-name:--font-title) text-fg-muted text-center py-8">
        {filter === 'all'
          ? 'No logs yet.'
          : `No ${LOG_FILTER_LABELS[filter].toLowerCase()} logs on this page.`}
      </p>
    {:else}
      <div class="space-y-3">
        <div
          class="flex items-center justify-between text-sm text-fg-muted uppercase tracking-widest"
        >
          <span>{rangeStart}–{rangeEnd} of {total}</span>
          {#if filter !== 'all'}
            <span>{items.length} shown</span>
          {/if}
        </div>
        <ul class="space-y-3">
          {#each items as entry (entry.id)}
            <li
              class="bg-bg border border-neon-cyan/30 rounded-lg hover:border-neon-cyan transition"
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
                    <span class="text-sm font-mono text-fg truncate">
                      {formatEventType(entry.eventType)}
                    </span>
                  </div>
                  <p class="text-fg-muted text-sm leading-relaxed">
                    {summarizeMessage(entry.message)}
                  </p>
                  <p class="text-xs text-fg-muted">{formatTimestamp(entry.timestamp)}</p>
                </div>
                <span
                  class="self-start sm:self-center text-xs uppercase tracking-widest text-neon-cyan whitespace-nowrap"
                >
                  {isExpanded(entry.id) ? 'Hide details' : 'Details'}
                </span>
              </button>

              {#if isExpanded(entry.id)}
                <div
                  class="border-t border-neon-cyan/20 px-4 pb-4 pt-3 space-y-3 text-sm"
                  data-testid="log-details"
                >
                  <div>
                    <p class="text-xs uppercase tracking-widest text-fg-muted mb-1">Full message</p>
                    <p class="text-fg whitespace-pre-wrap wrap-break-word">
                      {entry.message}
                    </p>
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p class="text-xs uppercase tracking-widest text-fg-muted mb-1">Gameplay</p>
                      <p class="font-mono text-xs break-all text-fg">
                        {entry.gameplayId ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p class="text-xs uppercase tracking-widest text-fg-muted mb-1">Player</p>
                      <p class="font-mono text-xs break-all text-fg">
                        {entry.playerId ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p class="text-xs uppercase tracking-widest text-fg-muted mb-1">Metadata</p>
                    <pre
                      class="overflow-x-auto rounded-lg border border-neon-cyan/20 bg-cell p-3 text-xs font-mono text-fg whitespace-pre-wrap wrap-break-word">{formatMetadata(
                        entry.metadata
                      )}</pre>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if !isLoading && activeTab === 'raw' && total > 0}
      <div
        class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-neon-cyan/30"
      >
        <p class="text-sm text-fg-muted uppercase tracking-widest">
          Page {page} / {totalPages}
        </p>
        <div class="flex gap-3">
          <button
            type="button"
            data-testid="export-csv"
            class="px-5 py-2 uppercase tracking-widest text-xs rounded-full border border-neon-magenta text-neon-magenta hover:bg-neon-magenta hover:text-bg transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neon-magenta"
            disabled={items.length === 0 || isExporting}
            onclick={handleExportCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            class="px-5 py-2 uppercase tracking-widest text-xs rounded-full border border-neon-cyan text-neon-cyan hover:bg-neon-cyan hover:text-bg transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neon-cyan"
            disabled={!canGoPrev}
            onclick={goPrev}
          >
            Previous
          </button>
          <button
            type="button"
            class="px-5 py-2 uppercase tracking-widest text-xs rounded-full border border-neon-cyan text-neon-cyan hover:bg-neon-cyan hover:text-bg transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neon-cyan"
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
