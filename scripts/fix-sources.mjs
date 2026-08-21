/**
 * Repoints every `sourceUrl` at the article Wikipedia actually serves.
 *
 * Titles were written by hand, so some are redirects and a few are pages that
 * do not exist at all. An attribution pointing at nothing is worse than none:
 * it looks like provenance and offers no way to check the claim.
 *
 *   node scripts/fix-sources.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'

const UA = { 'User-Agent': 'nyc-map-game/0.1 (ferguson.theo@gmail.com)' }
const API = 'https://en.wikipedia.org/w/api.php'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const path = new URL('../content/days.json', import.meta.url)
const days = JSON.parse(await readFile(path, 'utf8'))
const all = days.flatMap((d) => d.locations)
const titleOf = (l) => decodeURIComponent(l.sourceUrl.split('/wiki/')[1]).replace(/_/g, ' ')

/** Resolve redirects and find pages that are gone, 50 titles at a time. */
const resolved = new Map()
const missing = new Set()
for (let i = 0; i < all.length; i += 50) {
  const batch = [...new Set(all.slice(i, i + 50).map(titleOf))]
  const res = await fetch(
    `${API}?action=query&format=json&redirects=1&titles=${encodeURIComponent(batch.join('|'))}`,
    { headers: UA },
  )
  const q = (await res.json()).query
  for (const r of q.redirects ?? []) resolved.set(r.from, r.to)
  for (const p of Object.values(q.pages)) if (p.missing !== undefined) missing.add(p.title)
  await sleep(400)
}

/** For pages that do not exist, search by the location's own name. */
for (const l of all) {
  const title = titleOf(l)
  if (!missing.has(title)) continue
  const res = await fetch(
    `${API}?action=query&format=json&list=search&srlimit=1&srsearch=${encodeURIComponent(l.name + ' New York')}`,
    { headers: UA },
  )
  const hit = (await res.json()).query.search[0]
  if (hit) {
    resolved.set(title, hit.title)
    console.log(`  searched  ${title}\n         -> ${hit.title}`)
  } else {
    console.log(`  NO MATCH  ${title} (${l.name})`)
  }
  await sleep(400)
}

let changed = 0
for (const l of all) {
  const to = resolved.get(titleOf(l))
  if (!to) continue
  l.sourceUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(to.replace(/ /g, '_'))
  changed++
}
await writeFile(path, JSON.stringify(days, null, 2) + '\n')
console.log(`\nrepointed ${changed} source URLs`)
