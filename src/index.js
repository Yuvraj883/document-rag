// src/index.js
import 'dotenv/config'
import express from 'express'
import { Pinecone } from '@pinecone-database/pinecone'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { ingestDocuments } from './ingest.js'

// LangChain imports
import { PineconeStore } from '@langchain/pinecone'
import { OpenAIEmbeddings } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { PromptTemplate } from '@langchain/core/prompts'
// import { formatDocumentsAsString } from '@langchain/core/documents'
import { GoogleGenerativeAI } from '@google/generative-ai'
import cors from 'cors'

const app = express()
app.use(express.json())
app.use(cors({ origin: '*' }))
const PORT = process.env.PORT || 3000

let llm

const formatDocumentsAsString = (docs) =>
  docs.map((doc) => doc.pageContent).join('\n\n')

const documentsDir = path.join(process.cwd(), 'documents')
const archiveDir = path.join(process.cwd(), 'archive')
const upload = multer({ dest: documentsDir })

// -----------------------------
// 🚀 Initialize Chatbot
// -----------------------------
async function initializeChatbot() {
  try {
    console.log('🔄 Initializing Pinecone client...')
    const client = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    })

    const pineconeIndex = client.index('rag-project')

    // Embeddings
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
      openAIApiKey: process.env.OPENAI_API_KEY,
      dimensions: 512,
    })

    // Gemini LLM
    llm = new ChatGoogleGenerativeAI({
      modelName: 'models/gemini-2.0-flash-001',
      temperature: 0.7,
      maxOutputTokens: 1024,
      apiKey: process.env.GEMINI_API_KEY,
    })

    console.log('✅ Chatbot initialized successfully.')
  } catch (error) {
    console.error('❌ Failed to initialize chatbot:', error)
    process.exit(1)
  }
}

// -----------------------------
// 💬 Handle User Query
// -----------------------------
app.post('/ask', async (req, res) => {
  const { question, namespace } = req.body

  if (!question) return res.status(400).json({ error: 'Question is required.' })

  if (!llm)
    return res.status(503).json({ error: 'Chatbot still initializing.' })

  console.log(`🧠 Received question: ${question}`)

  try {
    // Create a new Pinecone client and index for each request
    const client = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    })
    const pineconeIndex = client.index('rag-project')
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
      openAIApiKey: process.env.OPENAI_API_KEY,
      dimensions: 512,
    })
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      namespace,
    })
    const retriever = vectorStore.asRetriever({ k: 4 })
    const relevantDocs = await retriever.getRelevantDocuments(question)
    console.log(`📄 Retrieved ${relevantDocs.length} documents.`)

    // Format docs
    const context = formatDocumentsAsString(relevantDocs)

    // Prompt
    const qaPrompt = PromptTemplate.fromTemplate(`
      You are a helpful and knowledgeable assistant. Treat the provided context as your own personal knowledge. Answer the question strictly based on the context, but do not reference images, figures, or visual content. If the context mentions images or figures, politely state that you cannot display them in this chat. Never mention or reference the documents or say 'the provided document' or 'the provided text'. Use clear, accurate, and concise language. If the context does not contain enough information to answer, simply say: "I don't know about that currently."

      Context:
      ${context}

      Question:
      ${question}

      Answer:
    `)

    // Generate answer
    const prompt = await qaPrompt.format({ context, question })
    const result = await llm.invoke(prompt)

    res.json({ answer: result.content, context })
  } catch (error) {
    console.error('❌ Error handling question:', error)
    res.status(500).json({ error: 'Failed to get an answer.' })
  }
})

app.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    // Move only .pdf and .txt files in documents/ to archive/
    fs.readdirSync(documentsDir).forEach((file) => {
      if (file.endsWith('.pdf') || file.endsWith('.txt')) {
        const oldPath = path.join(documentsDir, file)
        const archivePath = path.join(archiveDir, file)
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, archivePath)
        }
      }
    })

    // Move uploaded file to documents/ with original name
    const uploadedFile = req.file
    const ext = path.extname(uploadedFile.originalname)
    const newPath = path.join(documentsDir, uploadedFile.originalname)
    fs.renameSync(uploadedFile.path, newPath)

    // Get metadata from request
    const { organisation, website, namespace } = req.body

    // Optionally, save metadata to a file for reference
    // fs.writeFileSync(
    //   path.join(documentsDir, 'metadata.json'),
    //   JSON.stringify({ organisation, website, namespace }, null, 2)
    // )

    // Run ingestion with namespace
    const result = await ingestDocuments(namespace)
    res.json({ ...result, organisation, website, namespace })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/', (req, res) => {
  res.send('Welcome to the RAG Chatbot API!')
})

initializeChatbot().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`))
})
