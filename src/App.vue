<script setup lang="ts">
import { BContainer } from 'bootstrap-vue-next'
</script>

<template>
  <BContainer class="py-4 py-md-5 app-shell">
    <header class="mb-4 mb-md-5 page-hero">
      <h1 class="page-title">Pokopia Housing Solver</h1>
      <p>
        Optimize your Pokopia roommate assignments by matching likeminded Pokemon together and
        finding the items that fulfill the most favorites in a household.
      </p>
      <p>
        Made for fun by <a href="https://matthewlincoln.net">Matt Lincoln</a>, drawing on crucial
        datasets compiled by
        <a href="https://pokopia-roommate-matchmaker.netlify.app">Pokopia Roommate Matchmaker</a>
        and the <a href="https://github.com/mdlincoln/PokopiaPlanning">PokopiaPlanning dataset</a>.
      </p>
    </header>
    <main class="page-main">
      <RouterView />
    </main>
  </BContainer>
</template>
