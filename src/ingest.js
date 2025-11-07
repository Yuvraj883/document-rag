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
const ingestDocuments = async () => {
  try {
    console.log('🔄 Initializing Pinecone client...')
    const client = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    })

    const pineconeIndex = client.index('rag-project')

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
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    })

    const docs = await textSplitter.splitDocuments(rawDocs)
    console.log(`✅ Split into ${docs.length} chunks.`)

    // -----------------------------
    // 🧠 Embeddings
    // -----------------------------
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
      dimensions: 512,
    })

    // -----------------------------
    // 🌲 Store in Pinecone
    // -----------------------------
    console.log('🚀 Uploading embeddings to Pinecone...')
    await PineconeStore.fromDocuments(docs, embeddings, {
      pineconeIndex,
      namespace: 'your-namespace',
    })

    console.log('🎉 Documents successfully ingested into Pinecone!')
  } catch (error) {
    console.error('❌ Error ingesting documents:', error)
  }
}

ingestDocuments()
