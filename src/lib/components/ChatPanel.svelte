<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { sounds } from '$lib/audio/sounds';
  import { chatStore } from '$lib/stores/chat.svelte';
  import type { ChatMessage } from '$lib/types/chat';
  import { formatUsername } from '$lib/utils/text';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let inputValue = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let isAtBottom = $state(true);
  let hasUnreadSinceScroll = $state(false);
  let rateLimitRemaining = $state(0);
  let previousMessageCount = 0;

  function formatRelative(iso: string, now = Date.now()): string {
    if (!iso) return 'just now';

    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return iso;

    const deltaMs = now - parsed;
    const absDelta = Math.abs(deltaMs);

    if (absDelta < 60_000) return 'just now';
    if (absDelta < 60 * 60_000) return `${Math.max(1, Math.round(absDelta / 60_000))}m`;
    if (absDelta < 24 * 60 * 60_000) return `${Math.max(1, Math.round(absDelta / (60 * 60_000)))}h`;

    return new Date(parsed).toLocaleString();
  }

  function groupedMessages(): Array<{
    userId: string;
    userName: string;
    messages: ChatMessage[];
  }> {
    const groups: Array<{ userId: string; userName: string; messages: ChatMessage[] }> = [];

    for (const message of chatStore.messages) {
      const previous = groups.at(-1);
      if (!previous) {
        groups.push({ userId: message.userId, userName: message.userName, messages: [message] });
        continue;
      }

      const lastMessage = previous.messages[previous.messages.length - 1];
      const previousTs = Date.parse(lastMessage.timestamp);
      const currentTs = Date.parse(message.timestamp);
      const gapMs =
        Number.isFinite(previousTs) && Number.isFinite(currentTs)
          ? currentTs - previousTs
          : Infinity;
      const sameAuthor = previous.userId === message.userId;

      if (sameAuthor && gapMs <= 5 * 60_000) {
        previous.messages.push(message);
      } else {
        groups.push({ userId: message.userId, userName: message.userName, messages: [message] });
      }
    }

    return groups;
  }

  function handleScroll() {
    if (!listEl) return;

    isAtBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= 50;
    if (isAtBottom) {
      hasUnreadSinceScroll = false;
    }
  }

  function scrollToBottom() {
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }

  function handleUnreadPill() {
    hasUnreadSinceScroll = false;
    scrollToBottom();
  }

  $effect(() => {
    const nextCount = chatStore.messages.length;
    const shouldScroll = isAtBottom;

    if (nextCount > previousMessageCount) {
      if (shouldScroll) {
        void tick().then(() => {
          scrollToBottom();
        });
      } else {
        hasUnreadSinceScroll = true;
      }
    }

    previousMessageCount = nextCount;
  });

  $effect(() => {
    if (chatStore.rateLimitUntil === null) {
      rateLimitRemaining = 0;
      return;
    }

    const updateRemaining = () => {
      rateLimitRemaining = Math.max(0, chatStore.rateLimitUntil! - Date.now());
    };

    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 250);
    return () => window.clearInterval(intervalId);
  });

  const hasErrorArea = $derived(
    Boolean(chatStore.error) || Boolean(chatStore.authError) || rateLimitRemaining > 0
  );
  const sendDisabled = $derived(
    inputValue.trim().length === 0 || chatStore.status !== 'connected' || rateLimitRemaining > 0
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;

    // Send sound is owned by the panel because it owns the form.
    sounds.play('click');
    await chatStore.send(trimmed);

    if (chatStore.error === null) {
      inputValue = '';
      await tick();
      scrollToBottom();
    }
  }

  function handleCloseClick() {
    sounds.play('click');
    onClose();
  }

  function handleDismissError() {
    chatStore.clearError();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      sounds.play('click');
      onClose();
    }
  }

  onMount(() => {
    inputEl?.focus();
    void tick().then(() => scrollToBottom());
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed bottom-24 right-4 z-50 flex h-125 max-h-[70vh] w-90 max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-neon-cyan bg-bg shadow-glow-cyan sm:bottom-6 sm:right-6"
  role="region"
  aria-label="Chat"
>
  <header
    class="flex shrink-0 items-center justify-between gap-3 border-b border-neon-cyan/50 px-4 py-3"
  >
    <div class="flex items-center gap-2">
      <span class="text-xs font-semibold uppercase tracking-[0.28em] text-neon-cyan">
        Chat · {chatStore.usersCount}
      </span>
    </div>

    <div class="flex items-center gap-2">
      <span
        aria-label="Chat status"
        class={{
          'h-2.5 w-2.5 rounded-full bg-emerald-400': chatStore.status === 'connected',
          'h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse':
            chatStore.status === 'connecting' ||
            chatStore.status === 'authenticating' ||
            chatStore.status === 'reconnecting',
          'h-2.5 w-2.5 rounded-full bg-red-500':
            chatStore.status === 'error' || chatStore.status === 'disconnected',
          'h-2.5 w-2.5 rounded-full bg-neutral-500': chatStore.status === 'idle'
        }}
      ></span>
      <button
        type="button"
        aria-label="Close chat"
        data-testid="chat-close"
        class="text-xl leading-none text-fg transition hover:text-neon-cyan"
        onclick={handleCloseClick}
      >
        ×
      </button>
    </div>
  </header>

  <div class="relative flex-1 min-h-0 overflow-hidden">
    <div
      bind:this={listEl}
      onscroll={handleScroll}
      role="log"
      aria-live="polite"
      class="absolute inset-0 overflow-y-auto px-3 py-3 space-y-3"
    >
      {#each groupedMessages() as group (group.userId + ':' + group.messages[0].id)}
        <div class="flex flex-col gap-2">
          <div
            class="text-[10px] font-semibold uppercase tracking-[0.24em] text-neon-cyan opacity-80"
          >
            {formatUsername(group.userName)} · {formatRelative(group.messages[0].timestamp)}
          </div>

          {#each group.messages as message (message.id)}
            <div
              class="max-w-[82%] rounded-lg bg-cell px-3 py-2 text-sm text-fg shadow-sm"
              title={new Date(message.timestamp).toLocaleString()}
            >
              {message.content}
            </div>
          {/each}
        </div>
      {/each}
    </div>

    {#if hasUnreadSinceScroll}
      <button
        type="button"
        class="absolute bottom-3 right-3 rounded-full border border-neon-cyan bg-bg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-neon-cyan shadow-glow-cyan"
        onclick={handleUnreadPill}
      >
        New messages ↓
      </button>
    {/if}
  </div>

  {#if hasErrorArea}
    <div class="border-t border-neon-cyan/40 px-3 py-2">
      <div
        class="flex items-center justify-between gap-2 rounded-md bg-red-500/10 px-2 py-2 text-sm text-red-300"
      >
        <span>
          {#if rateLimitRemaining > 0}
            Wait {Math.ceil(rateLimitRemaining / 1000)}s
          {:else if chatStore.error}
            {chatStore.error}
          {:else}
            {chatStore.authError}
          {/if}
        </span>

        <button
          type="button"
          aria-label="Dismiss error"
          class="text-base leading-none text-red-200 transition hover:text-white"
          onclick={handleDismissError}
        >
          ×
        </button>
      </div>
    </div>
  {/if}

  <form class="shrink-0 border-t border-neon-cyan/40 p-3" onsubmit={handleSubmit}>
    <div class="flex items-center gap-2">
      <input
        type="text"
        bind:this={inputEl}
        bind:value={inputValue}
        aria-label="Message"
        maxlength={500}
        placeholder="Type a message..."
        disabled={chatStore.status !== 'connected' || rateLimitRemaining > 0}
        class="h-10 flex-1 rounded-lg border border-neon-cyan/70 bg-bg px-3 text-sm text-fg placeholder:text-fg-secondary focus:outline-none focus:ring-2 focus:ring-neon-cyan disabled:cursor-not-allowed disabled:opacity-60"
      />

      <button
        type="submit"
        disabled={sendDisabled}
        class="rounded-lg border border-neon-cyan bg-neon-cyan px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] text-bg transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Send
      </button>
    </div>

    {#if inputValue.length > 400}
      <div class="mt-2 text-right text-[10px] uppercase tracking-[0.2em] text-fg-secondary">
        {inputValue.length}/500
      </div>
    {/if}
  </form>
</div>
