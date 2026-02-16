import { v2 as cloudinary } from 'cloudinary'
import env from '#start/env'

cloudinary.config({
  cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
  api_key: env.get('CLOUDINARY_API_KEY'),
  api_secret: env.get('CLOUDINARY_API_SECRET'),
})

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '') 
    .replace(/[^a-zA-Z0-9_-]/g, '_') 
    .replace(/_+/g, '_') 
    .replace(/^_|_$/g, '') 
    .substring(0, 100) 
    || `video_${Date.now()}`
}

export async function uploadVideoToCloudinary(filePath: string, originalName: string) {
  try {
    const sanitizedName = sanitizeFilename(originalName)
    
    console.log(`📝 Original name: ${originalName}`)
    console.log(`✅ Sanitized name: ${sanitizedName}`)

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: 'reels',
      public_id: sanitizedName,
      overwrite: true,
      transformation: [
        { quality: 'auto', fetch_format: 'auto' },
      ],
    })

    const streamingUrl = cloudinary.url(result.public_id, {
      resource_type: 'video',
      streaming_profile: 'auto',
      format: 'm3u8', 
      secure: true,
    })

    return {
      url: result.secure_url,
      streamingUrl: streamingUrl,
      publicId: result.public_id,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
    }
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

export async function deleteVideoFromCloudinary(publicId: string) {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
    })
    return result
  } catch (error) {
    console.error('Cloudinary delete error:', error)
    throw error
  }
}

export default cloudinary