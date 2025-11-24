# Production File Handling Guide

## Overview

The application has been updated to handle file uploads in production environments (including serverless platforms like Vercel) where the filesystem is ephemeral and databases may not be available.

## Solution Approach

### ✅ **In-Memory Processing (Primary Solution)**

Files are now processed directly from memory buffers instead of being saved to disk:

1. **Multer Memory Storage**: Files are stored in memory during upload
2. **Direct Processing**: Files are processed from memory buffers using `pdf-parse` for PDFs
3. **Pinecone Storage**: Only embeddings are stored in Pinecone (the vector database)
4. **No File Persistence Required**: Original files are not stored after processing

### ✅ **Optional Cloud Storage (For File Persistence)**

If you need to keep original files for reference, you can optionally configure cloud storage:

- **AWS S3**: Store files in S3 buckets
- **Cloudinary**: Store files in Cloudinary
- **None (Default)**: Files are processed and discarded (embeddings remain in Pinecone)

## Configuration

### Basic Setup (No Cloud Storage)

No additional configuration needed! The application works out of the box with in-memory processing.

### Optional: AWS S3 Configuration

Add these environment variables:

```env
STORAGE_PROVIDER=s3
AWS_S3_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
```

Install AWS SDK:
```bash
npm install @aws-sdk/client-s3
```

### Optional: Cloudinary Configuration

Add these environment variables:

```env
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Install Cloudinary:
```bash
npm install cloudinary
```

## How It Works

1. **File Upload**: Client uploads file via `/ingest` endpoint
2. **Memory Storage**: Multer stores file in memory (no disk write)
3. **Processing**: File is parsed from memory buffer:
   - PDFs: Using `pdf-parse`
   - Text files: Direct UTF-8 conversion
4. **Embedding**: Text is split into chunks and embedded
5. **Pinecone**: Embeddings stored in Pinecone vector database
6. **Optional Storage**: If configured, original file uploaded to cloud storage
7. **Response**: Returns ingestion results with optional storage URL

## Benefits

✅ **Works in Serverless**: No filesystem dependencies  
✅ **No Database Required**: Files processed in memory  
✅ **Scalable**: Handles concurrent uploads efficiently  
✅ **Cost Effective**: Only store what you need (embeddings in Pinecone)  
✅ **Optional Persistence**: Add cloud storage only if needed  

## File Size Limits

- Default limit: **10MB** per file (configurable in `src/index.js`)
- Adjust in multer configuration if needed

## Migration Notes

- The old `documents/` directory approach still works for local development
- The `ingestDocuments()` function (directory-based) is still available
- Production uses `ingestDocumentFromBuffer()` for memory-based processing

