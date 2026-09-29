<script lang="ts">
  interface Props {
    text?: string;
  }

  let { text = 'TIC TAC TOE' }: Props = $props();
</script>

<h1 data-testid="game-title" class="text-center text-2xl md:text-4xl">
  {text}
</h1>
