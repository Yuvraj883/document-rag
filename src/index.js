// src/index.js
import 'dotenv/config'
import express from 'express'
import { Pinecone } from '@pinecone-database/pinecone'
import multer from 'multer'
import { ingestDocuments, ingestWebsite, ingestDocumentFromBuffer } from './ingest.js'

// LangChain imports
import { PineconeStore } from '@langchain/pinecone'
import { OpenAIEmbeddings } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { PromptTemplate } from '@langchain/core/prompts'
import { GoogleGenerativeAI } from '@google/generative-ai'
import cors from 'cors'

// Utils imports
import { formatDocumentsAsString } from './utils/text.js'
import { deriveNamespace } from './utils/namespace.js'

const app = express()
app.use(express.json())
app.use(cors({ origin: '*' }))
const PORT = process.env.PORT || 3000

// Use memory storage for production (works in serverless environments)
const storage = multer.memoryStorage()

// Configurable file size limit (default: 50MB, can be set via MAX_FILE_SIZE env var in bytes)
const maxFileSize = process.env.MAX_FILE_SIZE 
  ? parseInt(process.env.MAX_FILE_SIZE, 10) 
  : 50 * 1024 * 1024 // 50MB default

const upload = multer({ 
  storage,
  limits: {
    fileSize: maxFileSize,
  }
})

let llm

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

let msgHistory = [];

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

     Chat History:
     ${msgHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

      Question:
      ${question}

      Retrieval Context:
      ${context}


      Answer:
    `)
    
    msgHistory.push({ role: 'user', content: question })

    // Generate answer
    const prompt = await qaPrompt.format({ context, question })
    const result = await llm.invoke(prompt)
    msgHistory.push({ role: 'assistant', content: result.content })
    console.log(msgHistory)
    res.json({ answer: result.content })
  } catch (error) {
    console.error('❌ Error handling question:', error)
    res.status(500).json({ error: 'Failed to get an answer.' })
  }
})

app.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    // Get metadata from request
    const { organisation, website, namespace, url } = req.body
    const targetNamespace = deriveNamespace(namespace, organisation)
    const crawlTargetUrl = url?.trim() || website?.trim()
    const uploadedFile = req.file

    if (!uploadedFile && !crawlTargetUrl) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least a document file upload or a website URL to ingest.',
      })
    }

    const responsePayload = {
      success: true,
      organisation,
      website,
      url: crawlTargetUrl,
      namespace: targetNamespace,
    }

    // Process file from memory buffer (works in production/serverless)
    if (uploadedFile) {
      const documentResult = await ingestDocumentFromBuffer({
        buffer: uploadedFile.buffer,
        filename: uploadedFile.originalname,
        mimetype: uploadedFile.mimetype,
        namespace: targetNamespace,
      })
      responsePayload.documentIngestion = documentResult
      if (!documentResult.success) {
        return res.status(500).json({
          success: false,
          error: documentResult.error || 'Failed to ingest document.',
        })
      }
    }

    // Process website if URL provided
    if (crawlTargetUrl) {
      const websiteResult = await ingestWebsite({
        url: crawlTargetUrl,
        organisation,
        namespace: targetNamespace,
      })
      responsePayload.websiteIngestion = websiteResult
      if (!websiteResult.success) {
        return res.status(500).json({
          success: false,
          error: websiteResult.error || 'Failed to ingest website.',
        })
      }
    }

    res.json(responsePayload)
  } catch (error) {
    // Handle multer errors specifically
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        const maxSizeMB = Math.round(maxFileSize / (1024 * 1024))
        return res.status(400).json({
          success: false,
          error: `File too large. Maximum file size is ${maxSizeMB}MB.`,
          maxFileSize: maxFileSize,
          maxFileSizeMB: maxSizeMB,
        })
      }
      return res.status(400).json({
        success: false,
        error: `Upload error: ${error.message}`,
      })
    }
    res.status(500).json({ success: false, error: error.message })
  }
})

// Global error handler for multer errors that occur before route handler
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMB = Math.round(maxFileSize / (1024 * 1024))
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum file size is ${maxSizeMB}MB.`,
        maxFileSize: maxFileSize,
        maxFileSizeMB: maxSizeMB,
      })
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${error.message}`,
    })
  }
  next(error)
})

app.get('/', (req, res) => {
  res.send('Welcome to the RAG Chatbot API!')
})

initializeChatbot().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`))
})
