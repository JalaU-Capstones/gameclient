<script lang="ts">
  interface Props {
    visible?: boolean;
    disabled?: boolean;
  }

  let { visible = true, disabled = false }: Props = $props();
</script>

{#if visible}
  <div data-testid="chat-host" data-disabled={disabled ? 'true' : 'false'}></div>
{/if}
