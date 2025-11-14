// src/ingest.js

import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'

// -----------------------------
// ✅ LangChain Core Imports
// -----------------------------
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { OpenAIEmbeddings } from '@langchain/openai'
import { PineconeStore } from '@langchain/pinecone'
import { Document } from '@langchain/core/documents'
import { load as loadHtml } from 'cheerio'
import { XMLParser } from 'fast-xml-parser'

// ✅ FIXED Loader Imports for @langchain/community@0.2.9
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'

// -----------------------------
// ✅ Pinecone Client (v2 SDK)
// -----------------------------
import { Pinecone } from '@pinecone-database/pinecone'

// -----------------------------
// ✅ Path Setup
// -----------------------------
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// -----------------------------
// 🚀 Main Ingestion Function
// -----------------------------
const PINECONE_INDEX_NAME = 'rag-project'
const splitterConfig = { chunkSize: 1000, chunkOverlap: 200 }
const MIN_WEBSITE_LENGTH = 200
const MAX_WEBSITE_PAGES = Number(process.env.MAX_WEBSITE_PAGES || 20)
const MAX_LINKS_PER_PAGE = Number(process.env.MAX_LINKS_PER_PAGE || 50)
const crawlerUserAgent = 'document-rag-bot/1.0 (+https://github.com/)'
const xmlParser = new XMLParser({ ignoreAttributes: false })

const createTextSplitter = () => new RecursiveCharacterTextSplitter(splitterConfig)

const createEmbeddings = () =>
  new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
    dimensions: 512,
  })

const getPineconeIndex = () => {
  console.log('🔄 Initializing Pinecone client...')
  const client = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  })

  return client.index(PINECONE_INDEX_NAME)
}

const normalizeWhitespace = (text = '') => text.replace(/\s+/g, ' ').trim()

const parseHtmlToDocument = (html, url, organisation) => {
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

const toAbsoluteUrl = (value) => {
  if (!value) return null
  try {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (!/^https?:\/\//i.test(trimmed)) {
      return new URL(`https://${trimmed}`).href
    }
    return new URL(trimmed).href
  } catch {
    return null
  }
}

export async function ingestDocuments(namespace = 'default') {
  try {
    // -----------------------------
    // 📂 Load Documents
    // -----------------------------
    const loader = new DirectoryLoader(path.join(__dirname, '../documents'), {
      '.txt': (filePath) => new TextLoader(filePath),
      '.pdf': (filePath) => new PDFLoader(filePath),
    })

    const rawDocs = await loader.load()
    console.log(`✅ Loaded ${rawDocs.length} documents.`)

    // -----------------------------
    // ✂️ Split Text
    // -----------------------------
    const textSplitter = createTextSplitter()
    const docs = await textSplitter.splitDocuments(rawDocs)
    console.log(`✅ Split into ${docs.length} chunks.`)

    // -----------------------------
    // 🧠 Embeddings + Pinecone
    // -----------------------------
    const embeddings = createEmbeddings()
    const pineconeIndex = getPineconeIndex()

    // -----------------------------
    // 🌲 Store in Pinecone
    // -----------------------------
    console.log('🚀 Uploading embeddings to Pinecone...')
    await PineconeStore.fromDocuments(docs, embeddings, {
      pineconeIndex,
      namespace,
    })

    console.log('🎉 Documents successfully ingested into Pinecone!')
    return {
      success: true,
      message: 'Documents ingested successfully',
      chunks: docs.length,
      docs: rawDocs.length,
    }
  } catch (error) {
    console.error('❌ Error ingesting documents:', error)
    return { success: false, error: error.message }
  }
}

async function fetchWebsiteContent(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': crawlerUserAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

const extractLinks = (html, baseUrl, baseHost) => {
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

const fetchSitemapUrls = async (startUrl, limit = MAX_WEBSITE_PAGES) => {
  try {
    const base = new URL(startUrl)
    const sitemapUrl = new URL('/sitemap.xml', `${base.origin}/`).href
    console.log(`🗺️ Checking sitemap at ${sitemapUrl}`)
    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': crawlerUserAgent,
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      return []
    }

    const xml = await response.text()
    const parsed = xmlParser.parse(xml)
    const urls = []

    const urlset = parsed.urlset?.url
    if (urlset) {
      const entries = Array.isArray(urlset) ? urlset : [urlset]
      entries.forEach((entry) => {
        if (entry.loc) urls.push(entry.loc)
      })
    }

    return urls.slice(0, limit)
  } catch (error) {
    console.warn(`⚠️ Unable to parse sitemap for ${startUrl}: ${error.message}`)
    return []
  }
}

const downloadPagesSequentially = async (urls, limit = MAX_WEBSITE_PAGES) => {
  const pages = []
  for (const url of urls.slice(0, limit)) {
    try {
      console.log(`🌐 Fetching ${url}`)
      const html = await fetchWebsiteContent(url)
      pages.push({ url, html })
    } catch (error) {
      console.warn(`⚠️ Failed to fetch ${url}: ${error.message}`)
    }
  }
  return pages
}

const crawlWebsite = async (startUrl, limit = MAX_WEBSITE_PAGES) => {
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
      const html = await fetchWebsiteContent(current)
      pages.push({ url: current, html })

      if (pages.length >= limit) break

      const links = extractLinks(html, current, baseHost)
      links.forEach((link) => {
        if (!seen.has(link) && queue.length + pages.length < limit * 2) {
          queue.push(link)
        }
      })
    } catch (error) {
      console.warn(`⚠️ Failed to crawl ${current}: ${error.message}`)
    }
  }

  return pages
}

const collectWebsitePages = async (url, limit = MAX_WEBSITE_PAGES) => {
  const sitemapUrls = await fetchSitemapUrls(url, limit)
  if (sitemapUrls.length) {
    const normalized = sitemapUrls.includes(url) ? sitemapUrls : [url, ...sitemapUrls]
    console.log(`🧭 Sitemap found with ${normalized.length} URLs.`)
    return downloadPagesSequentially(normalized, limit)
  }

  console.log('🧭 No sitemap found, falling back to crawl.')
  return crawlWebsite(url, limit)
}

export async function ingestWebsite({
  url,
  organisation = 'unknown',
  namespace = 'default',
}) {
  try {
    const normalizedUrl = toAbsoluteUrl(url)
    if (!normalizedUrl) {
      throw new Error('A valid URL is required to scrape website content.')
    }

    console.log(`🌐 Collecting content starting from ${normalizedUrl}`)
    const pages = await collectWebsitePages(normalizedUrl, MAX_WEBSITE_PAGES)

    if (!pages.length) {
      throw new Error('No crawlable pages found for the provided website.')
    }

    const parsedDocuments = []
    for (const page of pages) {
      const parsed = parseHtmlToDocument(page.html, page.url, organisation)
      if (parsed.bodyText.length >= MIN_WEBSITE_LENGTH) {
        parsedDocuments.push(parsed.document)
      } else {
        console.log(`ℹ️ Skipping ${page.url} due to insufficient content.`)
      }
    }

    if (!parsedDocuments.length) {
      throw new Error('Scraped pages did not contain enough content to ingest.')
    }

    const textSplitter = createTextSplitter()
    const docs = await textSplitter.splitDocuments(parsedDocuments)
    console.log(`✅ Website content split into ${docs.length} chunks from ${parsedDocuments.length} pages.`)

    const embeddings = createEmbeddings()
    const pineconeIndex = getPineconeIndex()

    console.log('🚀 Uploading website embeddings to Pinecone...')
    await PineconeStore.fromDocuments(docs, embeddings, {
      pineconeIndex,
      namespace,
    })

    console.log('🎉 Website successfully ingested into Pinecone!')
    return {
      success: true,
      message: 'Website scraped and ingested successfully',
      chunks: docs.length,
      organisation,
      namespace,
      url: normalizedUrl,
      pagesProcessed: pages.length,
      pagesIndexed: parsedDocuments.length,
    }
  } catch (error) {
    console.error('❌ Error ingesting website:', error)
    return { success: false, error: error.message }
  }
}
