// lint-staged config. `src/data/` holds generated payloads owned by
// `npm run build:data` (see .prettierignore) — filter them out before
// invoking oxfmt so a data-only commit doesn't make oxfmt exit nonzero
// with "Expected at least one target file".
const oxfmt = (files) => {
  const targets = files.filter((f) => !f.startsWith('src/data/'))
  return targets.length ? `oxfmt ${targets.map((f) => JSON.stringify(f)).join(' ')}` : 'true'
}

export default {
  '*.{js,ts,vue}': ['eslint --fix --cache', 'oxlint --fix'],
  // Matches the old "src/**": ["oxfmt"] behavior, minus generated src/data/.
  '(src|scripts)/**/*.{js,ts,vue,json}': [oxfmt],
}
