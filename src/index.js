// src/index.js
import 'dotenv/config'
import express from 'express'
import { Pinecone } from '@pinecone-database/pinecone'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { ingestDocuments, ingestWebsite } from './ingest.js'

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

const deriveNamespace = (namespaceValue, organisation) => {
  if (namespaceValue && namespaceValue.trim()) return namespaceValue.trim()
  if (organisation && organisation.trim()) {
    const slug = organisation
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (slug) return slug
  }
  return 'default'
}

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

const moveUploadedFile = (uploadedFile) => {
  if (!uploadedFile) return null
  const newPath = path.join(documentsDir, uploadedFile.originalname)
  fs.renameSync(uploadedFile.path, newPath)
  return newPath
}

const archiveExistingDocuments = () => {
  fs.readdirSync(documentsDir).forEach((file) => {
    if (file.endsWith('.pdf') || file.endsWith('.txt')) {
      const oldPath = path.join(documentsDir, file)
      const archivePath = path.join(archiveDir, file)
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, archivePath)
      }
    }
  })
}

const ensureUploadDirectories = () => {
  if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true })
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true })
}

app.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    ensureUploadDirectories()

    // Move uploaded file to documents/ with original name
    const uploadedFile = req.file
    if (uploadedFile) {
      archiveExistingDocuments()
      moveUploadedFile(uploadedFile)
    }

    // Get metadata from request
  const { organisation, website, namespace, url } = req.body
    const targetNamespace = deriveNamespace(namespace, organisation)
  const crawlTargetUrl = url?.trim() || website?.trim()

    // Optionally, save metadata to a file for reference
    // fs.writeFileSync(
    //   path.join(documentsDir, 'metadata.json'),
    //   JSON.stringify({ organisation, website, namespace }, null, 2)
    // )

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

    if (uploadedFile) {
      const documentResult = await ingestDocuments(targetNamespace)
      responsePayload.documentIngestion = documentResult
      if (!documentResult.success) {
        return res.status(500).json({
          success: false,
          error: documentResult.error || 'Failed to ingest document.',
        })
      }
    }

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
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/', (req, res) => {
  res.send('Welcome to the RAG Chatbot API!')
})

initializeChatbot().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`))
})
