// src/ingest.js

import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

// pdf-parse is a CommonJS module - use createRequire for better compatibility
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

// -----------------------------
// ✅ LangChain Core Imports
// -----------------------------
import { PineconeStore } from '@langchain/pinecone'

// ✅ FIXED Loader Imports for @langchain/community@0.2.9
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { Document } from '@langchain/core/documents'

// -----------------------------
// ✅ Utils Imports
// -----------------------------
import { createTextSplitter, createEmbeddings, getPineconeIndex } from './utils/pinecone.js'
import { toAbsoluteUrl } from './utils/text.js'
import {
  parseHtmlToDocument,
  collectWebsitePages,
  MIN_WEBSITE_LENGTH,
  MAX_WEBSITE_PAGES,
} from './utils/website.js'
import { uploadToCloudStorage } from './utils/storage.js'

// -----------------------------
// ✅ Path Setup
// -----------------------------
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Process and ingest a document from a memory buffer
 * This works in production/serverless environments where filesystem is ephemeral
 */
export async function ingestDocumentFromBuffer({
  buffer,
  filename,
  mimetype,
  namespace = 'default',
}) {
  try {
    console.log(`📄 Processing file from memory: ${filename}`)

    let rawDocs = []

    // Process PDF files
    if (mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      const pdfData = await pdfParse(buffer)
      rawDocs = [
        new Document({
          pageContent: pdfData.text,
          metadata: {
            source: filename,
            pdfInfo: pdfData.info,
            totalPages: pdfData.numpages,
          },
        }),
      ]
    }
    // Process text files
    else if (
      mimetype?.startsWith('text/') ||
      filename.toLowerCase().endsWith('.txt')
    ) {
      const text = buffer.toString('utf-8')
      rawDocs = [
        new Document({
          pageContent: text,
          metadata: { source: filename },
        }),
      ]
    } else {
      // Try to parse as text if unknown type
      try {
        const text = buffer.toString('utf-8')
        rawDocs = [
          new Document({
            pageContent: text,
            metadata: { source: filename },
          }),
        ]
      } catch (error) {
        throw new Error(
          `Unsupported file type: ${mimetype || 'unknown'}. Supported types: PDF, TXT`
        )
      }
    }

    console.log(`✅ Loaded ${rawDocs.length} document(s) from buffer.`)

    // Split text
    const textSplitter = createTextSplitter()
    const docs = await textSplitter.splitDocuments(rawDocs)
    console.log(`✅ Split into ${docs.length} chunks.`)

    // Embeddings + Pinecone
    const embeddings = createEmbeddings()
    const pineconeIndex = getPineconeIndex()

    // Store in Pinecone
    console.log('🚀 Uploading embeddings to Pinecone...')
    await PineconeStore.fromDocuments(docs, embeddings, {
      pineconeIndex,
      namespace,
    })

    // Optionally upload original file to cloud storage
    let storageResult = null
    if (process.env.STORAGE_PROVIDER && process.env.STORAGE_PROVIDER !== 'none') {
      console.log('☁️ Uploading original file to cloud storage...')
      storageResult = await uploadToCloudStorage(buffer, filename, namespace)
    }

    console.log('🎉 Document successfully ingested into Pinecone!')
    return {
      success: true,
      message: 'Document ingested successfully',
      chunks: docs.length,
      docs: rawDocs.length,
      filename,
      storage: storageResult,
    }
  } catch (error) {
    console.error('❌ Error ingesting document from buffer:', error)
    return { success: false, error: error.message }
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
