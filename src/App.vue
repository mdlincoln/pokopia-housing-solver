<script setup lang="ts">
import { BContainer } from 'bootstrap-vue-next'
</script>

<template>
  <BContainer class="py-3">
    <header class="mb-4">
      <h1>Pokemon Housing</h1>
    </header>
    <main>
      <RouterView />
    </main>
  </BContainer>
</template>
