// Tells Bing (and through it DuckDuckGo, Yahoo, Ecosia and ChatGPT search)
// that khapee.com's pages exist or have changed, via IndexNow — free, and no
// account. Run after a deploy that changes what the public pages say:
//
//   node scripts/indexnow.mjs
//
// The key is public by design: search engines fetch it from
// https://khapee.com/<key>.txt to confirm the request came from the site.
const KEY = 'ae7157c4b1b14b27345885de375d2148'
const HOST = 'khapee.com'

const sitemap = await (await fetch(`https://${HOST}/sitemap.xml`)).text()
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
})
console.log(`IndexNow: ${urls.length} URLs → ${r.status} ${r.statusText}`)
