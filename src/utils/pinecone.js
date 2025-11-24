// src/utils/pinecone.js

import { Pinecone } from '@pinecone-database/pinecone'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { OpenAIEmbeddings } from '@langchain/openai'

// -----------------------------
// Constants
// -----------------------------
export const PINECONE_INDEX_NAME = 'rag-project'
export const splitterConfig = { chunkSize: 1000, chunkOverlap: 200 }

// -----------------------------
// Text Splitter
// -----------------------------
export const createTextSplitter = () => new RecursiveCharacterTextSplitter(splitterConfig)

// -----------------------------
// Embeddings
// -----------------------------
export const createEmbeddings = () =>
  new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
    dimensions: 512,
  })

// -----------------------------
// Pinecone Index
// -----------------------------
export const getPineconeIndex = () => {
  console.log('🔄 Initializing Pinecone client...')
  const client = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  })

  return client.index(PINECONE_INDEX_NAME)
}

