// src/index.js
import 'dotenv/config'
import express from 'express'
import { Pinecone } from '@pinecone-database/pinecone'

// LangChain imports
import { PineconeStore } from '@langchain/pinecone'
import { OpenAIEmbeddings } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { PromptTemplate } from '@langchain/core/prompts'
// import { formatDocumentsAsString } from '@langchain/core/documents'
import { GoogleGenerativeAI } from "@google/generative-ai";


const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

let vectorStore
let llm

const formatDocumentsAsString = (docs) =>
  docs.map((doc) => doc.pageContent).join('\n\n')

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

    // Vector store
    vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      namespace: 'your-namespace',
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
  const { question } = req.body

  if (!question) return res.status(400).json({ error: 'Question is required.' })

  if (!vectorStore || !llm)
    return res.status(503).json({ error: 'Chatbot still initializing.' })

  console.log(`🧠 Received question: ${question}`)

  try {
    // Retrieve relevant docs
    const retriever = vectorStore.asRetriever({ k: 4 })
    const relevantDocs = await retriever.getRelevantDocuments(question)
    console.log(`📄 Retrieved ${relevantDocs.length} documents.`)

    // Format docs
    const context = formatDocumentsAsString(relevantDocs)

    // Prompt
    const qaPrompt = PromptTemplate.fromTemplate(`
      You are a helpful assistant. Use the provided context to answer the question.
      If you don't know the answer, just say you don't know.

      Context:
      ${context}

      Question:
      ${question}

      Answer:
    `)

    // Generate answer
    const prompt = await qaPrompt.format({ context, question })
    const result = await llm.invoke(prompt)

    res.json({ answer: result.content })
  } catch (error) {
    console.error('❌ Error handling question:', error)
    res.status(500).json({ error: 'Failed to get an answer.' })
  }
})

initializeChatbot().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`))
})
