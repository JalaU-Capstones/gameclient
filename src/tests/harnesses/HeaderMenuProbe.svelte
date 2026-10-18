<script lang="ts">
  interface Props {
    isAuthenticated: boolean;
    canGoBack: boolean;
    showGoToLobby: boolean;
    isLeavingGame: boolean;
    disabled: boolean;
    onBack: () => void;
    onLogout: () => void;
  }

  let props: Props = $props();
</script>

<div
  data-testid="header-menu"
  data-authenticated={props.isAuthenticated}
  data-disabled={props.disabled}
></div>
