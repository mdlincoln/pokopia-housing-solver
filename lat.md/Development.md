# Development

This template should help get you started developing with Vue 3 in Vite.

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

Install project dependencies using npm.

```sh
npm install
```

### Compile and Hot-Reload for Development

Start the development server with hot module reloading for rapid iteration.

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

Perform type checking and create an optimized production bundle.

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

Run unit tests using Vitest, a fast unit test framework.

```sh
npm run test:unit
```

ALWAYS run unit tests after updating anything.

### Run End-to-End Tests with [Playwright](https://playwright.dev)

Run e2e tests using Playwright on Chromium to verify the full app works in a real browser.

```sh
# Install Chromium for the first run
npm run playwright install chromium

# Run e2e tests
npm run test:e2e
```

ALWAYS run e2e tests after updating anything.

### Lint with [ESLint](https://eslint.org/)

Check code quality and style compliance using ESLint.

```sh
npm run lint
```

## Pre-commit Hook

Formatting and linting run automatically on every commit via husky.

The hook runs `npm run format` (oxfmt) and aborts if formatting modified any files so the user must stage those edits before retrying. After that it runs `npm run lint` (oxlint + ESLint).

## Continuous Integration

GitHub Actions builds the production bundle on every push to `main` so deployment always uses the same release process as local builds.

The workflow installs Node from `.nvmrc`, runs `npm ci`, and then runs `npm run build`. That build command already combines `vue-tsc` type-checking with the Vite production bundle.

## Deployment

Production assets are published from `dist/` to the `web` branch and served from the `/pokopia-housing-solver/` subpath.

The Vite config sets the production base path to `/pokopia-housing-solver/` while keeping development at `/`. The Vue Router history already uses `import.meta.env.BASE_URL`, so route generation stays aligned with the deployed asset paths.
