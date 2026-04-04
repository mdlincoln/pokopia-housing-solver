<script setup lang="ts"></script>

<template>
  <div class="app">
    <header>
      <h1>Pokemon Housing</h1>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

header {
  margin-bottom: 1.5rem;
}

h1 {
  font-size: 1.5rem;
  margin: 0;
}
</style>
