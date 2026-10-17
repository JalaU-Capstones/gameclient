<script lang="ts">
  interface Props {
    seconds: number;
    disabled?: boolean;
    onclick?: () => void;
    label: string;
    class?: string;
    dataTestId?: string;
  }

  let {
    seconds,
    disabled = false,
    onclick,
    label,
    class: className = '',
    dataTestId = 'countdown-button'
  }: Props = $props();

  let remaining = $state(0);

  $effect(() => {
    const nextSeconds = seconds;
    remaining = nextSeconds;
    if (remaining <= 0) return;

    const interval = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
    }, 1000);

    return () => clearInterval(interval);
  });

  let isDisabled = $derived(disabled || remaining > 0);
  let text = $derived(remaining > 0 ? `${label} (${remaining}s)` : label);
</script>

<button
  type="button"
  disabled={isDisabled}
  {onclick}
  class={className}
  data-testid={dataTestId}
  aria-live="polite"
>
  {text}
</button>
