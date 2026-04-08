<script setup lang="ts">
import { BContainer } from 'bootstrap-vue-next'
</script>

<template>
  <BContainer class="py-4 py-md-5 app-shell">
    <header class="mb-4 mb-md-5 page-hero">
      <h1 class="page-title">Pokemon Housing</h1>
    </header>
    <main class="page-main">
      <RouterView />
    </main>
  </BContainer>
</template>
