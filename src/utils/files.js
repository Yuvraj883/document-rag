// src/utils/files.js

import fs from 'fs'
import path from 'path'

// -----------------------------
// File Path Constants
// -----------------------------
export const documentsDir = path.join(process.cwd(), 'documents')
export const archiveDir = path.join(process.cwd(), 'archive')

// -----------------------------
// Directory Management
// -----------------------------
export const ensureUploadDirectories = () => {
  if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true })
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true })
}

// -----------------------------
// File Operations
// -----------------------------
export const moveUploadedFile = (uploadedFile) => {
  if (!uploadedFile) return null
  const newPath = path.join(documentsDir, uploadedFile.originalname)
  fs.renameSync(uploadedFile.path, newPath)
  return newPath
}

export const archiveExistingDocuments = () => {
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

