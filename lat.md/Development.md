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

### Run End-to-End Tests with [Playwright](https://playwright.dev)

Run e2e tests using Playwright on Chromium to verify the full app works in a real browser.

```sh
# Install Chromium for the first run
npm run playwright install chromium

# Run e2e tests
npm run test:e2e
```

### Lint with [ESLint](https://eslint.org/)

Check code quality and style compliance using ESLint.

```sh
npm run lint
```

## Pre-commit Hook

Formatting and linting run automatically on every commit via husky. The hook runs `npm run format` (oxfmt) then `npm run lint` (oxlint + ESLint). Both fix issues in place; the commit is blocked if unfixable errors remain.
