<template>
  <div class="countdown-page">
    <AppNavBar title="倒数日" />
    <div class="page-placeholder">
      <i class="fa-solid fa-hourglass-half"></i>
      <p>倒数日功能即将上线</p>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
export default {
  name: 'Countdown',
  components: { AppNavBar }
};
</script>

<style scoped>
.countdown-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.page-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  gap: 12px;
}
.page-placeholder i { font-size: 48px; }
.page-placeholder p { font-size: var(--font-size-body); }
</style>
