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

/**
 * Below this a fact is almost certainly definitional and nothing more --
 * "a 526-acre urban park in Brooklyn" and no reason to care. Some articles have
 * a one-line lead, so for those the opening of the body is worth more than the
 * intro alone.
 */
const RICH = 140

/** Never exceed this, even chasing RICH. A card is not an essay. */
const HARD_MAX = 420

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

/** Full extracts carry section headings; a card is not a table of contents. */
const stripHeadings = (text) => text.replace(/^=+\s*[^=]+\s*=+$/gm, ' ')

/** Whole sentences only -- a card ending mid-clause reads as a bug. */
function trim(text) {
  // Split only where punctuation is followed by space and a capital. Splitting
  // on every full stop cuts through decimals, "St." and "U.S." alike.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“'])/)
  let out = ''
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s
    if (next.length > HARD_MAX) break
    // Stop at the target -- unless we are still short of a fact worth reading,
    // in which case one more sentence beats a definition. Breaking purely on
    // TARGET left a short opening sentence stranded whenever the next one was
    // long, which is most of why the thin facts stayed thin.
    if (out && next.length > TARGET && out.length >= RICH) break
    out = next
    if (out.length >= TARGET) break
  }
  return out.trim()
}

/**
 * Retries, because this makes several hundred sequential requests and a single
 * transient failure loses the whole run -- the file is only written at the end.
 */
async function fetchExtract(title, introOnly, attempt = 0) {
  try {
    const res = await fetch(
      'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1' +
        `&prop=extracts|pageprops&explaintext=1&exlimit=1${introOnly ? '&exintro=1' : ''}` +
        `&titles=${encodeURIComponent(title)}`,
      { headers: UA, signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const page = Object.values((await res.json()).query.pages)[0]
    return {
      title: page.title,
      text: page.extract ?? '',
      // Wikipedia marks these itself, which beats matching on "may refer to".
      disambiguation: page.pageprops?.disambiguation !== undefined,
    }
  } catch (err) {
    if (attempt >= 3) {
      console.error(`  giving up on "${title}": ${err.message}`)
      return { title, text: '' }
    }
    await sleep(1000 * 2 ** attempt)
    return fetchExtract(title, introOnly, attempt + 1)
  }
}

/**
 * A disambiguation page yields text that looks like a fact and is a menu:
 * "Fulton Ferry may refer to: ...". It reads as plausible prose, passes every
 * length check, and is about nothing.
 */
const isDisambiguation = (page) => page.disambiguation

const short = [], failed = [], deepened = [], ambiguous = []
for (const [n, loc] of all.entries()) {
  const intro = await fetchExtract(titleOf(loc), true)
  if (isDisambiguation(intro)) {
    ambiguous.push(`${loc.id} -> ${intro.title}`)
    await sleep(220)
    continue
  }
  let fact = trim(clean(intro.text))
  await sleep(220)

  // A one-line lead is common for parks and small landmarks. Reading into the
  // body is still the article's own text, so the attribution stays true --
  // which writing something richer ourselves would not.
  if (fact.length < RICH) {
    const full = await fetchExtract(titleOf(loc), false)
    const deeper = trim(clean(stripHeadings(full.text)))
    if (deeper.length > fact.length) {
      fact = deeper
      deepened.push(`${loc.id} (${fact.length})`)
    }
    await sleep(220)
  }

  if (fact.length < MIN) failed.push(`${loc.id} (${fact.length} chars from "${intro.title}")`)
  else {
    loc.factShort = fact
    if (fact.length < RICH) short.push(`${loc.id} (${fact.length})`)
  }
  if ((n + 1) % 50 === 0) console.error(`  ${n + 1}/${all.length}`)
}

await writeFile(path, JSON.stringify(days, null, 2) + '\n')
console.log(`\npulled ${all.length - failed.length} of ${all.length}`)
if (failed.length) {
  console.log(`\ntoo short to use, left as written (${failed.length}):`)
  failed.forEach((f) => console.log('  ' + f))
}
if (ambiguous.length) {
  console.log(`\nDISAMBIGUATION PAGES, left as written (${ambiguous.length}):`)
  ambiguous.forEach((a) => console.log('  ' + a))
}
if (deepened.length) console.log(`\nfilled out from the body (${deepened.length}): ${deepened.join(', ')}`)
if (short.length) console.log(`\nstill thin (${short.length}): ${short.join(', ')}`)
