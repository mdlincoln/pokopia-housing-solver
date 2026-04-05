#!/usr/bin/env node
// Precomputes an adjacency matrix of shared-favorites counts between all pokemon.
// Run once: node scripts/precompute-adjacency.js
// Output: public/pokemon_adjacency.json

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const favoritesPath = join(root, 'public', 'pokemon_favorites.json')
const outputPath = join(root, 'public', 'pokemon_adjacency.json')

const data = JSON.parse(readFileSync(favoritesPath, 'utf8'))
const pokemon = Object.keys(data)
const n = pokemon.length

// Build favorite sets once
const favSets = pokemon.map((name) => new Set(data[name].favorites))

// Dense N×N matrix, initialized to 0
const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))

for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    let shared = 0
    for (const fav of favSets[i]) {
      if (favSets[j].has(fav)) shared++
    }
    matrix[i][j] = shared
    matrix[j][i] = shared
  }
}

writeFileSync(outputPath, JSON.stringify({ pokemon, matrix }, null, 2))
console.log(`Written ${n}×${n} adjacency matrix to ${outputPath}`)
