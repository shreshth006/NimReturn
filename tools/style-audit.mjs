/**
 * Guards the design system. A stylesheet drifts back into noise one "just this once"
 * value at a time, so this counts every ad-hoc number and fails when the vocabulary grows.
 *
 *   node tools/style-audit.mjs
 *
 * It reports raw values that should be tokens, and enforces a budget per property.
 */
import { readFileSync } from 'node:fs'

const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const body = CSS.slice(CSS.indexOf('}') + 1)   // skip the :root token block

// How many distinct values each property may use. Lower is better; raise only with reason.
const BUDGET = {
  'font-size': 14,
  'font-weight': 5,
  'border-radius': 7,
  'box-shadow': 7,
  gap: 18,
  padding: 42,
}

// Values that legitimately stay raw.
const ALLOWED_RAW = new Set(['0', '1px', '2px', '3px', '50%', '100%', 'auto', 'inherit', 'none'])

let failures = 0
console.log('Design vocabulary\n')

for (const [property, budget] of Object.entries(BUDGET)) {
  const pattern = new RegExp(`(?<![-\\w])${property}: ([^;{}]+)`, 'g')
  const values = [...body.matchAll(pattern)].map((match) => match[1].trim())
  const distinct = [...new Set(values)]
  const raw = distinct.filter((value) => !value.includes('var(') && !ALLOWED_RAW.has(value))
  const over = distinct.length > budget

  console.log(`  ${property.padEnd(14)} ${String(distinct.length).padStart(3)} distinct (budget ${budget})${over ? '  OVER BUDGET' : ''}`)
  if (raw.length > 0) {
    console.log(`    ${raw.length} not using a token: ${raw.slice(0, 6).map((v) => JSON.stringify(v)).join(', ')}${raw.length > 6 ? ' …' : ''}`)
  }
  if (over) failures += 1
}

// One primary action per screen is a pattern; several is a guessing game.
const primaryButtons = (body.match(/\.button-primary\b/gu) ?? []).length
if (primaryButtons > 1) {
  console.log(`\n  note: .button-primary defined ${primaryButtons} times`)
}

console.log(failures === 0
  ? '\nVocabulary is within budget.'
  : `\n${failures} propert${failures === 1 ? 'y is' : 'ies are'} over budget — move the odd values onto a token scale.`)

process.exit(failures === 0 ? 0 : 1)
