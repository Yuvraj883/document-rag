// src/utils/text.js

// -----------------------------
// Text Normalization
// -----------------------------
export const normalizeWhitespace = (text = '') => text.replace(/\s+/g, ' ').trim()

// -----------------------------
// Document Formatting
// -----------------------------
export const formatDocumentsAsString = (docs) =>
  docs.map((doc) => doc.pageContent).join('\n\n')

// -----------------------------
// URL Utilities
// -----------------------------
export const toAbsoluteUrl = (value) => {
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

