<script lang="ts">
  interface Props {
    visible: boolean;
    currentPath: string;
    disabled?: boolean;
  }

  let { visible, currentPath, disabled = false }: Props = $props();
</script>

{#if visible}
  <div data-testid="dock" data-active-path={currentPath} data-disabled={disabled}></div>
{/if}
