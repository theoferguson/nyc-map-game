/**
 * Flags facts and sources that need a human to look at them.
 *
 * The facts were written from knowledge and pointed at a Wikipedia article, not
 * extracted from one. That makes `sourceUrl` a claim about where a reader could
 * check the fact rather than a record of where it came from -- so both the link
 * and the claim need verifying, and neither can be fully automated.
 *
 * What CAN be automated is falsification, which is most of the value:
 *
 *   1. Does the linked article sit where the location does? Wikipedia carries
 *      coordinates, so a wrong article is usually a wrong place.
 *   2. Do the years in the fact appear anywhere in the article? A date that
 *      appears nowhere in the source is either wrong or unsupported by it.
 *
 * Neither proves a fact true. Both narrow 250 reads to the handful worth
 * reading first.
 *
 *   node scripts/verify-facts.mjs
 */
import { readFile } from 'node:fs/promises'

const UA = { 'User-Agent': 'nyc-map-game/0.1 (ferguson.theo@gmail.com)' }
const API = 'https://en.wikipedia.org/w/api.php'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Beyond this the article is almost certainly about somewhere else. */
const MAX_KM = 3

const days = JSON.parse(await readFile(new URL('../content/days.json', import.meta.url), 'utf8'))
const all = days.flatMap((d) => d.locations)
const titleOf = (l) => decodeURIComponent(l.sourceUrl.split('/wiki/')[1]).replace(/_/g, ' ')

const km = (a, b) => {
  const R = 6371, rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const pages = new Map()

// Coordinates batch fifty at a time; full article text does not batch at all.
// MediaWiki silently returns only the lead section when several titles are
// requested together, which made every date living in the body look absent --
// 169 false flags, which is noise rather than signal.
for (let i = 0; i < all.length; i += 50) {
  const batch = [...new Set(all.slice(i, i + 50).map(titleOf))]
  const res = await fetch(
    `${API}?action=query&format=json&redirects=1&prop=coordinates&colimit=max&titles=${encodeURIComponent(batch.join('|'))}`,
    { headers: UA },
  )
  for (const p of Object.values((await res.json()).query.pages)) {
    pages.set(p.title, { coord: p.coordinates?.[0], text: '', missing: p.missing !== undefined })
  }
  await sleep(300)
}

const titles = [...new Set(all.map(titleOf))]
for (const [n, t] of titles.entries()) {
  const res = await fetch(
    `${API}?action=query&format=json&redirects=1&prop=extracts&explaintext=1&exlimit=1` +
      `&titles=${encodeURIComponent(t)}`,
    { headers: UA },
  )
  const page = Object.values((await res.json()).query.pages)[0]
  const entry = pages.get(page.title) ?? pages.get(t)
  if (entry) entry.text = page.extract ?? ''
  if ((n + 1) % 50 === 0) console.error(`  fetched ${n + 1}/${titles.length} articles`)
  await sleep(250)
}

const findTitle = (t) => pages.get(t) ?? [...pages.values()].find(() => false)

const wrongPlace = [], unsupported = [], noPage = [], noCoords = []
for (const l of all) {
  const page = findTitle(titleOf(l))
  if (!page || page.missing) { noPage.push(l); continue }

  if (page.coord) {
    const d = km({ lat: l.lat, lng: l.lng }, { lat: page.coord.lat, lng: page.coord.lon })
    if (d > MAX_KM) wrongPlace.push({ l, d })
  } else noCoords.push(l)

  // Years are the highest-risk, most checkable claim in a fact.
  const years = [...new Set(l.factShort.match(/\b1[6-9]\d{2}|\b20[0-2]\d\b/g) ?? [])]
  const absent = years.filter((y) => !page.text.includes(y))
  if (absent.length) unsupported.push({ l, absent, years: years.length })
}

const show = (title, rows, fmt) => {
  console.log(`\n${title}: ${rows.length}`)
  rows.forEach((r) => console.log('  ' + fmt(r)))
}
show('LINKED ARTICLE IS SOMEWHERE ELSE', wrongPlace, ({ l, d }) => `${d.toFixed(1)}km  ${l.id}  -> ${titleOf(l)}`)
show('SOURCE PAGE MISSING', noPage, (l) => `${l.id} -> ${titleOf(l)}`)
show('YEARS NOT FOUND IN THE ARTICLE', unsupported, ({ l, absent }) => `${l.id}: ${absent.join(', ')}`)
console.log(`\narticles without coordinates (cannot be position-checked): ${noCoords.length}`)
console.log(`clean: ${all.length - wrongPlace.length - noPage.length - unsupported.length} of ${all.length}`)
