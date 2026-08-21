/**
 * Rewrites every `factShort` from the opening of its Wikipedia article.
 *
 * Facts used to be written from knowledge with a Wikipedia URL attached
 * afterwards, which made `sourceAttribution` a claim rather than a record --
 * text nobody derived from the article, licensed as though they had. Pulling
 * the extract makes the attribution true, and makes the whole content pipeline
 * mechanical, which is what the generative engine will need.
 *
 * The trade is voice. An extract reads like an encyclopaedia because it is one.
 * Rewriting for voice is a later pass over text that is at least correct.
 *
 *   node scripts/pull-facts.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'

const UA = { 'User-Agent': 'nyc-map-game/0.1 (ferguson.theo@gmail.com)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Two or three sentences: enough to be interesting, short enough for the card. */
const TARGET = 300
const MIN = 60

const path = new URL('../content/days.json', import.meta.url)
const days = JSON.parse(await readFile(path, 'utf8'))
const all = days.flatMap((d) => d.locations)
const titleOf = (l) => decodeURIComponent(l.sourceUrl.split('/wiki/')[1]).replace(/_/g, ' ')

/**
 * Extracts carry things a card should not: IPA and pronunciation respellings,
 * alternate-name asides, and the bracketed leftovers of stripped templates.
 */
function clean(text) {
  return (
    text
      .replace(/\([^)]*(?:\/|listen|pronounced|IPA|ˈ)[^)]*\)/g, '')
      // Unit conversions -- "(38.7 m)", "(213 ha)". These have to go before any
      // sentence splitting: the decimal point inside them reads as a full stop
      // and tears the sentence in half around the closing bracket.
      .replace(/\s*\([^)]*\b(?:m|km|ha|ft|mi|km2|m2|acres|sq\s*mi|kg|t)\b[^)]*\)/gi, '')
      .replace(/\s*\([^)]{0,4}\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim()
  )
}

/** Whole sentences only -- a card ending mid-clause reads as a bug. */
function trim(text) {
  // Split only where punctuation is followed by space and a capital. Splitting
  // on every full stop cuts through decimals, "St." and "U.S." alike.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“'])/)
  let out = ''
  for (const s of sentences) {
    if (out && (out + s).length > TARGET) break
    out += (out ? ' ' : '') + s
    if (out.length >= TARGET) break
  }
  return out.trim()
}

const short = [], failed = []
for (const [n, loc] of all.entries()) {
  const res = await fetch(
    'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1' +
      `&prop=extracts&explaintext=1&exintro=1&exlimit=1&titles=${encodeURIComponent(titleOf(loc))}`,
    { headers: UA },
  )
  const page = Object.values((await res.json()).query.pages)[0]
  const fact = trim(clean(page.extract ?? ''))

  if (fact.length < MIN) {
    failed.push(`${loc.id} (${fact.length} chars from "${page.title}")`)
  } else {
    loc.factShort = fact
    if (fact.length < 120) short.push(`${loc.id} (${fact.length})`)
  }
  if ((n + 1) % 50 === 0) console.error(`  ${n + 1}/${all.length}`)
  await sleep(220)
}

await writeFile(path, JSON.stringify(days, null, 2) + '\n')
console.log(`\npulled ${all.length - failed.length} of ${all.length}`)
if (failed.length) {
  console.log(`\ntoo short to use, left as written (${failed.length}):`)
  failed.forEach((f) => console.log('  ' + f))
}
if (short.length) console.log(`\nthin but usable (${short.length}): ${short.slice(0, 12).join(', ')}`)
