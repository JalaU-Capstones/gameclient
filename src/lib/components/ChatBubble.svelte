<script lang="ts">
  interface Props {
    onClick: () => void;
    unreadCount?: number;
  }

  let { onClick, unreadCount = 0 }: Props = $props();

  const badgeText = $derived(unreadCount >= 100 ? '99+' : String(unreadCount));
</script>

<button
  type="button"
  aria-label="Open chat"
  aria-haspopup="dialog"
  aria-expanded={false}
  data-testid="chat-bubble"
  data-unread={unreadCount}
  class="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--neon-cyan)] bg-[var(--bg)] shadow-[var(--glow-cyan)] transition-transform active:scale-95"
  onclick={onClick}
>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6 text-[var(--neon-cyan)]">
    <path
      d="M6 8.75A2.75 2.75 0 0 1 8.75 6h6.5A2.75 2.75 0 0 1 18 8.75v5.5A2.75 2.75 0 0 1 15.25 17H10l-4 3v-3.5A2.75 2.75 0 0 1 6 14.25v-5.5Z"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path d="M9 10.5h6M9 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>

  {#if unreadCount > 0}
    <span
      aria-label={`${unreadCount} unread messages`}
      class="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-md"
    >
      {badgeText}
    </span>
  {/if}
</button>
