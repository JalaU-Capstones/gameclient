<script lang="ts">
  import { onlinePlayers } from '$lib/stores/onlinePlayers.svelte';
  import { currentUser } from '$lib/stores/session';
  import type { PublicUser } from '$lib/types/api';
  import { formatUsername, sanitizeDisplayName } from '$lib/utils/text';

  interface Props {
    title?: string;
    disabled?: boolean;
    emptyMessage?: string;
    onInvite?: (user: PublicUser) => void;
  }

  let {
    title = 'Online players',
    disabled = false,
    emptyMessage = 'No players online.',
    onInvite
  }: Props = $props();

  const visible = $derived(onlinePlayers.users.filter((user) => user.id !== $currentUser?.id));
</script>

<div class="rounded-2xl border border-neon-cyan bg-cell p-4 shadow-glow-cyan">
  <p class="mb-3 text-xs uppercase tracking-[0.25em] text-fg-muted">{title}</p>
  {#if visible.length === 0}
    <p class="py-2 text-center text-sm text-fg-muted">{emptyMessage}</p>
  {:else}
    <ul class="space-y-2">
      {#each visible as user (user.id)}
        {@const isPlaying = onlinePlayers.playingIds.has(user.id)}
        <li
          class="flex items-center justify-between gap-3 rounded-xl border border-neon-cyan/40 bg-bg px-4 py-3"
        >
          <span class="truncate font-semibold text-fg"
            >{formatUsername(sanitizeDisplayName(user.name))}</span
          >
          {#if onInvite}
            <button
              type="button"
              class="rounded-full border border-neon-magenta px-4 py-1 text-xs font-bold uppercase tracking-widest text-neon-magenta transition hover:bg-neon-magenta hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || isPlaying}
              onclick={() => onInvite(user)}
            >
              {isPlaying ? 'Playing' : 'Invite'}
            </button>
          {:else if isPlaying}
            <span class="text-xs uppercase tracking-widest text-amber-400">Playing</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
