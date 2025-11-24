// src/utils/website.js

import { load as loadHtml } from 'cheerio'
import { XMLParser } from 'fast-xml-parser'
import { Document } from '@langchain/core/documents'
import { normalizeWhitespace } from './text.js'

// -----------------------------
// Constants
// -----------------------------
export const MIN_WEBSITE_LENGTH = 200
export const MAX_WEBSITE_PAGES = Number(process.env.MAX_WEBSITE_PAGES || 200)
export const MAX_LINKS_PER_PAGE = Number(process.env.MAX_LINKS_PER_PAGE || 50)

// Realistic browser User-Agents (rotated to avoid detection)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

// -----------------------------
// Browser Headers Generator
// -----------------------------
export const getBrowserHeaders = (referer = null) => {
  // Randomly select a User-Agent
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'DNT': '1',
    'Sec-GPC': '1',
  }

  // Add Referer if provided (makes it look like navigation from another page)
  if (referer) {
    headers['Referer'] = referer
  }

  return headers
}

// Headers for XML/sitemap requests
export const getSitemapHeaders = () => {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  
  return {
    'User-Agent': userAgent,
    'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
  }
}

// -----------------------------
// XML Parser
// -----------------------------
export const xmlParser = new XMLParser({ 
  ignoreAttributes: false,
  ignoreNameSpace: true,
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseNodeValue: false,
})

// -----------------------------
// HTML Parsing
// -----------------------------
export const parseHtmlToDocument = (html, url, organisation) => {
  const $ = loadHtml(html)
  $('script, style, noscript, iframe, svg').remove()
  const title = normalizeWhitespace($('title').first().text()) || url
  const bodyText = normalizeWhitespace($('body').text())

  return {
    title,
    bodyText,
    document: new Document({
      pageContent: bodyText,
      metadata: {
        source: url,
        organisation: organisation || 'unknown',
        title,
        scrapedAt: new Date().toISOString(),
      },
    }),
  }
}

// -----------------------------
// Website Fetching
// -----------------------------
export const fetchWebsiteContent = async (url, referer = null) => {
  const response = await fetch(url, {
    headers: getBrowserHeaders(referer),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

// -----------------------------
// Link Extraction
// -----------------------------
export const extractLinks = (html, baseUrl, baseHost) => {
  const $ = loadHtml(html)
  const links = new Set()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const resolved = new URL(href, baseUrl)
      if (!['http:', 'https:'].includes(resolved.protocol)) return
      if (resolved.hostname !== baseHost) return
      resolved.hash = ''
      links.add(resolved.href)
    } catch {
      // ignore invalid URLs
    }
  })
  return Array.from(links).slice(0, MAX_LINKS_PER_PAGE)
}

// -----------------------------
// Sitemap Utilities
// -----------------------------
export const extractUrlsFromSitemap = (parsed, rawXml = '') => {
  const urls = []

  // Handle standard sitemap format: urlset.url
  const urlset = parsed.urlset?.url
  if (urlset) {
    const entries = Array.isArray(urlset) ? urlset : [urlset]
    entries.forEach((entry) => {
      // Try multiple possible property names
      const loc = entry.loc || entry['@_loc'] || entry['#text'] || entry['loc'] || entry['@loc']
      if (loc && typeof loc === 'string') {
        urls.push(loc.trim())
      }
    })
  }

  // Handle sitemap index format: sitemapindex.sitemap
  const sitemapindex = parsed.sitemapindex?.sitemap
  if (sitemapindex) {
    const entries = Array.isArray(sitemapindex) ? sitemapindex : [sitemapindex]
    entries.forEach((entry) => {
      const loc = entry.loc || entry['@_loc'] || entry['#text'] || entry['loc'] || entry['@loc']
      if (loc && typeof loc === 'string') {
        urls.push(loc.trim())
      }
    })
  }

  // Fallback: if no URLs found and we have raw XML, try regex extraction
  if (urls.length === 0 && rawXml) {
    console.log(`   🔍 Trying fallback regex extraction from XML...`)
    const urlMatches = rawXml.match(/<loc>(.*?)<\/loc>/gi)
    if (urlMatches) {
      urlMatches.forEach((match) => {
        const url = match.replace(/<\/?loc>/gi, '').trim()
        if (url && url.startsWith('http')) {
          urls.push(url)
        }
      })
    }
  }

  return urls
}

export const fetchSitemapUrls = async (startUrl, limit = MAX_WEBSITE_PAGES) => {
  const base = new URL(startUrl)
  const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']
  
  for (const sitemapPath of sitemapPaths) {
    try {
      const sitemapUrl = new URL(sitemapPath, `${base.origin}/`).href
      console.log(`🗺️ Checking sitemap at ${sitemapUrl}`)
      
      const response = await fetch(sitemapUrl, {
        headers: getSitemapHeaders(),
      })

      if (!response.ok) {
        console.log(`   ⚠️ Sitemap not found at ${sitemapUrl} (${response.status})`)
        continue
      }

      const xml = await response.text()
      
      // Check if it's a sitemap index (contains links to other sitemaps)
      if (xml.includes('sitemapindex') || xml.includes('sitemap-index')) {
        console.log(`   📋 Found sitemap index, fetching nested sitemaps...`)
        const parsed = xmlParser.parse(xml)
        const nestedSitemapUrls = extractUrlsFromSitemap(parsed, xml)
        
        if (nestedSitemapUrls.length === 0) {
          console.log(`   ⚠️ Sitemap index found but no nested sitemaps extracted`)
          continue
        }

        // Fetch URLs from all nested sitemaps
        const allUrls = []
        for (const nestedUrl of nestedSitemapUrls.slice(0, 10)) { // Limit to 10 nested sitemaps
          try {
            const nestedResponse = await fetch(nestedUrl, {
              headers: getSitemapHeaders(),
            })
            if (nestedResponse.ok) {
              const nestedXml = await nestedResponse.text()
              const nestedParsed = xmlParser.parse(nestedXml)
              const nestedUrls = extractUrlsFromSitemap(nestedParsed, nestedXml)
              allUrls.push(...nestedUrls)
            }
          } catch (error) {
            console.warn(`   ⚠️ Failed to fetch nested sitemap ${nestedUrl}: ${error.message}`)
          }
        }
        
        if (allUrls.length > 0) {
          console.log(`   ✅ Found ${allUrls.length} URLs from sitemap index`)
          return allUrls.slice(0, limit)
        }
      } else {
        // Standard sitemap
        const parsed = xmlParser.parse(xml)
        const urls = extractUrlsFromSitemap(parsed, xml)
        
        if (urls.length > 0) {
          console.log(`   ✅ Found ${urls.length} URLs in sitemap`)
          return urls.slice(0, limit)
        } else {
          console.log(`   ⚠️ Sitemap found but no URLs extracted (check XML structure)`)
          // Log a sample of the parsed structure for debugging
          console.log(`   🔍 Sample parsed structure:`, JSON.stringify(parsed).substring(0, 200))
        }
      }
    } catch (error) {
      console.warn(`   ⚠️ Error checking sitemap ${sitemapPath}: ${error.message}`)
      continue
    }
  }

  return []
}

// -----------------------------
// Website Crawling
// -----------------------------
export const downloadPagesSequentially = async (urls, limit = MAX_WEBSITE_PAGES) => {
  const pages = []
  let previousUrl = null
  const urlsToFetch = urls.slice(0, limit)
  
  for (let i = 0; i < urlsToFetch.length; i++) {
    const url = urlsToFetch[i]
    try {
      console.log(`🌐 Fetching ${url}`)
      // Use previous URL as referer to simulate natural browsing
      const html = await fetchWebsiteContent(url, previousUrl)
      pages.push({ url, html })
      previousUrl = url
      
      // Add a small delay between requests to avoid rate limiting (except for last request)
      if (i < urlsToFetch.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500))
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch ${url}: ${error.message}`)
    }
  }
  return pages
}

export const crawlWebsite = async (startUrl, limit = MAX_WEBSITE_PAGES) => {
  const queue = [startUrl]
  const seen = new Set()
  const pages = []
  const baseHost = new URL(startUrl).hostname

  while (queue.length && pages.length < limit) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)

    try {
      console.log(`🔎 Crawling ${current}`)
      // Use the last crawled page as referer to simulate natural navigation
      const referer = pages.length > 0 ? pages[pages.length - 1].url : null
      const html = await fetchWebsiteContent(current, referer)
      pages.push({ url: current, html })

      if (pages.length >= limit) break

      const links = extractLinks(html, current, baseHost)
      links.forEach((link) => {
        if (!seen.has(link) && queue.length + pages.length < limit * 2) {
          queue.push(link)
        }
      })
      
      // Add a random delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000))
    } catch (error) {
      console.warn(`⚠️ Failed to crawl ${current}: ${error.message}`)
    }
  }

  return pages
}

export const collectWebsitePages = async (url, limit = MAX_WEBSITE_PAGES) => {
  const sitemapUrls = await fetchSitemapUrls(url, limit)
  if (sitemapUrls.length) {
    const normalized = sitemapUrls.includes(url) ? sitemapUrls : [url, ...sitemapUrls]
    console.log(`🧭 Sitemap found with ${normalized.length} URLs.`)
    return downloadPagesSequentially(normalized, limit)
  }

  console.log('🧭 No sitemap found, falling back to crawl.')
  return crawlWebsite(url, limit)
}

