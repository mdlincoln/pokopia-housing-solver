<script setup lang="ts">
import { changelog } from '@/changelog'
</script>

<template>
  <section class="home-theme content-stack" data-testid="changelog">
    <h2 class="section-heading">Changelog</h2>
    <p class="changelog-intro">What's changed on the Pokopia Housing Solver, bucketed by week.</p>
    <article
      v-for="entry in changelog"
      :key="entry.date"
      class="shell-card shell-card-body changelog-entry"
      data-testid="changelog-entry"
    >
      <h3 class="changelog-date">{{ entry.date }} — {{ entry.summary }}</h3>
      <ul class="changelog-changes">
        <li v-for="change in entry.changes" :key="change">{{ change }}</li>
      </ul>
    </article>
    <p v-if="changelog.length === 0" data-testid="changelog-empty" class="changelog-empty">
      No changelog entries yet.
    </p>
  </section>
</template>
