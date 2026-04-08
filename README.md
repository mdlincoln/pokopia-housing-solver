# pokopia-housing-solver

A browser-based tool to optimize the cohousing plan for your Pokopia island. I had found several tools for finding highly-ranked roommates for an individual Pokémon, but nothing that would optimize arrangements of an entire set of Pokémon into available housing. This approaches uses agglomerative network clustering to cheaply lump together Pokémon with multiple overlapping favorties, while keeping Pokémon with diverging habitat preferences (e.g. `Bright` vs `Dark`) under different roofs.

## Credits

This project in indebted to the original data collection done by https://pokopia-roommate-matchmaker.netlify.app/ and https://github.com/JEschete/PokopiaPlanning.
