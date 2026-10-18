<script lang="ts">
  import { tick } from 'svelte';
  import { sounds } from '$lib/audio/sounds';
  import { chatStore } from '$lib/stores/chat.svelte';
  import ChatBubble from './ChatBubble.svelte';
  import ChatPanel from './ChatPanel.svelte';

  interface Props {
    visible: boolean;
    disabled?: boolean;
  }

  let { visible, disabled = false }: Props = $props();
  let wasOpenBeforeDisabled = $state(false);

  function applyInert(node: HTMLElement, disabledState: boolean) {
    const update = (isDisabled: boolean) => {
      if (isDisabled) {
        node.setAttribute('inert', '');
      } else {
        node.removeAttribute('inert');
      }
    };

    update(disabledState);
    return { update };
  }

  async function restoreBubbleFocus() {
    await tick();
    document.querySelector<HTMLButtonElement>('[data-testid="chat-bubble"]')?.focus();
  }

  function handleOpen() {
    sounds.play('click');
    void chatStore.open();
  }

  async function handleClose() {
    chatStore.close();
    await restoreBubbleFocus();
  }

  $effect(() => {
    if (!visible && !disabled && chatStore.isOpen) {
      chatStore.close();
    }
  });

  $effect(() => {
    if (disabled) {
      if (chatStore.isOpen && !wasOpenBeforeDisabled) {
        wasOpenBeforeDisabled = true;
        chatStore.close();
      }
      return;
    }

    if (wasOpenBeforeDisabled) {
      wasOpenBeforeDisabled = false;
      void chatStore.open();
    }
  });

  $effect(() => {
    if (chatStore.isOpen && !disabled) {
      chatStore.markRead();
    }
  });
</script>

{#if visible}
  <div data-testid="chat-host" use:applyInert={disabled}>
    {#if chatStore.isOpen}
      <ChatPanel onClose={handleClose} />
    {:else}
      <ChatBubble onClick={handleOpen} unreadCount={chatStore.unreadCount} />
    {/if}
  </div>
{/if}
