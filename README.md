# pokopia-housing-solver

A browser-based tool to optimize the cohousing plan for your Pokopia island. I had found several tools for finding highly-ranked roommates for an individual Pokemon, but nothing that would optimize arrangements of an entire set of pokemon into available housing. This approaches uses agglomerative network clustering to cheaply lump together Pokemon with multiple overlapping favorties, while keeping Pokemon with diverging habitat preferences (e.g. `Bright` vs `Dark`) under different roofs.

## Credits

This project in indebted to the original data collection done by https://pokopia-roommate-matchmaker.netlify.app/ and https://github.com/JEschete/PokopiaPlanning.
