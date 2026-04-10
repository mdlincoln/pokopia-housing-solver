<script setup lang="ts">
import ShoppingCart from '@/components/ShoppingCart.vue'
import { BContainer } from 'bootstrap-vue-next'
</script>

<template>
  <div class="d-flex align-items-start app-layout">
    <BContainer class="py-4 py-md-5 app-shell flex-fill min-w-0">
      <header class="mb-4 mb-md-5 page-hero">
        <h1 class="page-title">Pokopia Housing Solver</h1>
        <p>
          Optimize your Pokopia roommate assignments by matching likeminded Pokémon together and
          finding the items that fulfill the most favorites in a household.
        </p>
        <p>
          I had found several tools for finding highly-ranked roommates for an individual Pokémon,
          but nothing that would optimize arrangements of an entire set of Pokémon into available
          housing. This approach uses agglomerative clustering to cheaply lump together Pokémon with
          multiple overlapping favorites, while keeping Pokémon with diverging habitat preferences
          (e.g.
          <strong>Bright</strong> vs. <strong>Dark</strong>) under different roofs.
        </p>
        <p>
          Made for fun by <a href="https://matthewlincoln.net">Matt Lincoln</a>, drawing on crucial
          datasets compiled by
          <a href="https://pokopia-roommate-matchmaker.netlify.app">Pokopia Roommate Matchmaker</a>
          and the
          <a href="https://github.com/mdlincoln/PokopiaPlanning">PokopiaPlanning dataset</a>.
        </p>
      </header>
      <main class="page-main">
        <RouterView />
      </main>
      <footer class="app-footer mt-4 mt-md-5" aria-label="Project source">
        <span>Source:</span>
        <a href="https://github.com/mdlincoln/pokopia-housing-solver">pokopia-housing-solver</a>
        ❧
        <span>Created by <a href="https://matthewlincoln.net">Matt Lincoln</a>, 2026</span>
      </footer>
    </BContainer>
    <ShoppingCart />
  </div>
</template>
