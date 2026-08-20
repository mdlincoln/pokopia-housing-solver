// Deterministic formatter for the baked JSON payloads. `src/data/` is listed
// in .prettierignore so lint-staged's oxfmt pass leaves these files alone —
// the bake is the sole owner of their formatting, keeping `npm run
// build:data` byte-stable against the committed files.
//
// Format: 2-space indent; objects and arrays always expand one entry per
// line. Arrays-of-scalars (e.g. favorites lists) collapse onto one line when
// they fit within LINE_WIDTH, for readability of the pokemon catalog.

const LINE_WIDTH = 100

export function formatDataJson(value) {
  return format(value, 0) + '\n'
}

function format(value, depth) {
  if (Array.isArray(value)) {
    return formatArray(value, depth)
  }
  if (value !== null && typeof value === 'object') {
    return formatObject(value, depth)
  }
  return JSON.stringify(value)
}

function isScalar(v) {
  return v === null || typeof v !== 'object'
}

function formatArray(arr, depth) {
  if (arr.length === 0) return '[]'
  if (arr.every(isScalar)) {
    const oneLine = `[${arr.map((v) => JSON.stringify(v)).join(', ')}]`
    if ('  '.repeat(depth).length + oneLine.length <= LINE_WIDTH) return oneLine
  }
  const indent = '  '.repeat(depth)
  const inner = arr.map((v) => '  '.repeat(depth + 1) + format(v, depth + 1))
  return `[\n${inner.join(',\n')}\n${indent}]`
}

function formatObject(obj, depth) {
  const entries = Object.entries(obj)
  if (entries.length === 0) return '{}'
  const inner = entries.map(
    ([k, v]) => '  '.repeat(depth + 1) + `${JSON.stringify(k)}: ${format(v, depth + 1)}`,
  )
  return `{\n${inner.join(',\n')}\n${'  '.repeat(depth)}}`
}
