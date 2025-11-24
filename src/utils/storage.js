// src/utils/storage.js
// Optional cloud storage utilities for file persistence
// This is optional - files are processed in memory and embeddings stored in Pinecone

/**
 * Upload file to cloud storage (optional)
 * Currently supports AWS S3, but can be extended to support other providers
 * 
 * To use this, set environment variables:
 * - STORAGE_PROVIDER: 's3' | 'cloudinary' | 'none' (default: 'none')
 * - AWS_S3_BUCKET: Your S3 bucket name
 * - AWS_ACCESS_KEY_ID: AWS access key
 * - AWS_SECRET_ACCESS_KEY: AWS secret key
 * - AWS_REGION: AWS region (e.g., 'us-east-1')
 */

/**
 * Upload a file buffer to cloud storage
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} namespace - Namespace for organization
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function uploadToCloudStorage(buffer, filename, namespace = 'default') {
  const provider = process.env.STORAGE_PROVIDER || 'none'

  if (provider === 'none') {
    // No cloud storage configured - this is fine, files are processed in memory
    return { success: true, message: 'Cloud storage not configured' }
  }

  try {
    if (provider === 's3') {
      return await uploadToS3(buffer, filename, namespace)
    } else if (provider === 'cloudinary') {
      return await uploadToCloudinary(buffer, filename, namespace)
    } else {
      return { success: false, error: `Unsupported storage provider: ${provider}` }
    }
  } catch (error) {
    console.error('Error uploading to cloud storage:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Upload to AWS S3
 */
async function uploadToS3(buffer, filename, namespace) {
  try {
    // Dynamic import to avoid requiring AWS SDK if not used
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })

    const key = `${namespace}/${Date.now()}-${filename}`
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: getContentType(filename),
    })

    await s3Client.send(command)
    const url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`

    return { success: true, url, key }
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      return {
        success: false,
        error: 'AWS SDK not installed. Run: npm install @aws-sdk/client-s3',
      }
    }
    throw error
  }
}

/**
 * Upload to Cloudinary
 */
async function uploadToCloudinary(buffer, filename, namespace) {
  try {
    // Dynamic import to avoid requiring Cloudinary if not used
    const { v2: cloudinary } = await import('cloudinary')

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: namespace,
          public_id: `${Date.now()}-${filename.replace(/\.[^/.]+$/, '')}`,
          resource_type: 'auto',
        },
        (error, result) => {
          if (error) {
            reject(error)
          } else {
            resolve({ success: true, url: result.secure_url, publicId: result.public_id })
          }
        }
      )

      uploadStream.end(buffer)
    })
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      return {
        success: false,
        error: 'Cloudinary not installed. Run: npm install cloudinary',
      }
    }
    throw error
  }
}

/**
 * Get content type from filename
 */
function getContentType(filename) {
  const ext = filename.toLowerCase().split('.').pop()
  const types = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  return types[ext] || 'application/octet-stream'
}

