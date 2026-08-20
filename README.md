# pokopia-housing-solver

A browser-based tool to optimize the cohousing plan for your Pokopia island. I had found several tools for finding highly-ranked roommates for an individual Pokémon, but nothing that would optimize arrangements of an entire set of Pokémon into available housing. This approaches uses agglomerative clustering to cheaply lump together Pokémon with multiple overlapping favorties, while keeping Pokémon with diverging habitat preferences (e.g. `Bright` vs `Dark`) under different roofs.

## Data maintenance

The Serebii scrapers are stdlib Node scripts (no Python required).

```bash
npm run harvest:pokemon              # scrape + add missing pokemon
npm run harvest:pokemon -- --dry-run # report only, no writes
npm run harvest:pokemon -- --verify  # completeness + integrity check
npm run harvest:pokemon -- --delay 1.0

npm run harvest:items                # scrape + add missing items
npm run harvest:items -- --dry-run   # report only, no writes
npm run harvest:items -- --verify    # completeness + integrity check
npm run harvest:items -- --delay 1.0

npm run test:harvest                 # node:test regression suite
```

Use `-- <flag>` to pass flags through npm to the scripts (as shown above). The
scripts request pages with a jittered delay to scrape politely (raise it with
`--delay`). `node:sqlite` is experimental and prints a harmless warning on Node 22.

## Credits

This project in indebted to the original data collection done by https://pokopia-roommate-matchmaker.netlify.app/ and https://github.com/JEschete/PokopiaPlanning.
