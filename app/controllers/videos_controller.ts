import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import drive from '@adonisjs/drive/services/main'
import Video from '#models/video'
import { videoProcessingQueue } from '#services/queue_service'
import fs from 'node:fs'
import { uploadVideoToCloudinary } from '#services/cloudinary_service'
import type { VideoQuality, VideoResolution,AdvancedFilters } from '#services/video_service'
import VideoService from '#services/video_service'
import { cuid } from '@adonisjs/core/helpers'
import { unlink } from 'node:fs/promises'
import path from 'node:path'

// ─── Validation constants ─────────────────────────────────────────────────────

const SUPPORTED_FORMATS: string[]              = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpeg']
const SUPPORTED_QUALITIES: VideoQuality[]      = ['lossless', 'high', 'medium', 'low']
const SUPPORTED_RESOLUTIONS: VideoResolution[] = ['360p', '480p', '720p', '1080p', '1440p', '4k']

export default class VideosController {

  async index({ auth, response }: HttpContext) {
    // const user = await auth.authenticate()
    const videos = await Video.query()
      .where('user_id', 1)
      .orderBy('created_at', 'desc')
    
    const formattedVideos = videos.map(video => ({
      id: video.id,
      title: video.title,
      status: video.status,
      cloudinaryUrl: video.cloudinaryUrl,
      cloudinaryStreamingUrl: video.cloudinaryStreamingUrl,
      cloudinaryPublicId: video.cloudinaryPublicId,
      duration: video.duration,
      resolution: video.resolution,
      fileSize: video.fileSize,
      extension: video.extension,
      createdAt: video.createdAt,
    }))
    
    return response.ok({ count: formattedVideos.length, videos: formattedVideos })
  }

  async show({ params, auth, response }: HttpContext) {
    // const user = await auth.authenticate()
    const video = await Video.query()
      .where('id', params.id)
      .where('user_id', 1)
      .firstOrFail()
    
    return response.ok({ 
      video: {
        id: video.id,
        title: video.title,
        status: video.status,
        cloudinaryUrl: video.cloudinaryUrl,
        cloudinaryStreamingUrl: video.cloudinaryStreamingUrl,
        cloudinaryPublicId: video.cloudinaryPublicId,
        duration: video.duration,
        resolution: video.resolution,
        fileSize: video.fileSize,
        extension: video.extension,
        createdAt: video.createdAt,
      }
    })
  }

async upload({ request, auth, response }: HttpContext) {
  // const user = await auth.authenticate()
  const userId = 1
  const uploadStartTime = Date.now()

  const videoFile = request.file('video', {
    extnames: ['mp4', 'avi', 'mov', 'mkv', 'webm'],
    size: '2gb',
  })

  if (!videoFile || !videoFile.isValid) {
    return response.badRequest({
      error: 'No video file provided or invalid',
      details: videoFile?.errors,
    })
  }

  const ext = videoFile.extname || 'mp4'
  const storagePath = `videos/${userId}/${Date.now()}.${ext}`
  await videoFile.moveToDisk(storagePath)

  const uploadDuration = Date.now() - uploadStartTime

  // Create video record in DB
  const video = await Video.create({
    userId,
    title: request.input('title', videoFile.clientName),
    originalFilename: videoFile.clientName || 'unknown',
    storagePath,
    fileSize: videoFile.size || 0,
    mimeType: `video/${ext}`,
    status: 'uploading',
    extension: ext,
    uploadTime: DateTime.now(),
    uploadDuration,
  })

  try {
    // Upload to Cloudinary and WAIT for it to complete
    const filePath = app.makePath('storage', storagePath)
    const fileName = videoFile.clientName || `video_${Date.now()}`
    
    const cloudinaryResult = await uploadVideoToCloudinary(filePath, fileName)

    // Update with Cloudinary URLs
    video.cloudinaryUrl = cloudinaryResult.url
    video.cloudinaryStreamingUrl = cloudinaryResult.streamingUrl
    video.cloudinaryPublicId = cloudinaryResult.publicId
    video.status = 'uploaded'
    await video.save()

    // Queue for audio/subtitle processing in background
    videoProcessingQueue?.add('process-video', {
      videoId: video.id,
      storagePath: filePath,
    }).catch(err => console.error('Queue error:', err))

    // Return with streaming URL
    return response.created({
      message: 'Video uploaded successfully to Cloudinary',
      video: {
        id: video.id,
        title: video.title,
        extension: ext,
        uploadTime: video.uploadTime,
        uploadDuration,
        uploadDurationSeconds: (uploadDuration / 1000).toFixed(2),
        status: video.status,
        cloudinaryUrl: video.cloudinaryUrl,
        cloudinaryStreamingUrl: video.cloudinaryStreamingUrl,
        cloudinaryPublicId: video.cloudinaryPublicId,
      }
    })

  } catch (err) {
    console.error('Cloudinary upload failed:', err)
    video.status = 'failed'
    video.errorMessage = 'Cloudinary upload failed'
    await video.save()

    return response.status(500).json({
      error: 'Cloudinary upload failed',
      message: err.message,
      video: {
        id: video.id,
        status: 'failed'
      }
    })
  }
}


  async uploadMultiple({ request, auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const videoFiles = request.files('videos', {
      extnames: ['mp4', 'avi', 'mov', 'mkv', 'webm'],
      size: '2gb'
    })

    const uploaded = []
    const failed = []

    for (const file of videoFiles) {
      if (!file.isValid) {
        failed.push({ filename: file.clientName, errors: file.errors })
        continue
      }

      const uploadStartTime = Date.now()

      const ext = file.extname || 'mp4'
      const path = `videos/${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`
      await file.moveToDisk(path)

      const uploadDuration = Date.now() - uploadStartTime

      const video = await Video.create({
        userId: user.id,
        title: file.clientName || `Video ${uploaded.length + 1}`,
        originalFilename: file.clientName || 'unknown',
        storagePath: path,
        fileSize: file.size || 0,
        mimeType: `video/${ext}`,
        status: 'uploaded',
        extension: ext,
        uploadTime: DateTime.now(),
        uploadDuration,
      })

      try {
        await videoProcessingQueue?.add('process-video', {
          videoId: video.id,
          storagePath: app.makePath('storage', path)
        })
        await video.merge({ status: 'processing' }).save()
      } catch {}

      uploaded.push({
        id: video.id,
        title: video.title,
        uploadDuration: `${(uploadDuration / 1000).toFixed(2)}s`
      })
    }

    return response.created({
      message: `${uploaded.length} uploaded`,
      uploaded,
      failed
    })
  }

  async stream({ params, request, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)
    const path = app.makePath('storage', video.storagePath)
    
    if (!existsSync(path)) {
      return response.notFound({ error: 'File not found' })
    }

    const stat = statSync(path)
    const size = stat.size
    const range = request.header('range')

    if (range) {
      const [s, e] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(s, 10)
      const end = e ? parseInt(e, 10) : size - 1
      response.status(206)
      response.header('Content-Range', `bytes ${start}-${end}/${size}`)
      response.header('Accept-Ranges', 'bytes')
      response.header('Content-Length', String(end - start + 1))
      response.header('Content-Type', video.mimeType || 'video/mp4')
      return response.stream(createReadStream(path, { start, end }))
    }

    response.header('Content-Length', String(size))
    response.header('Content-Type', video.mimeType || 'video/mp4')
    response.header('Accept-Ranges', 'bytes')
    return response.stream(createReadStream(path))
  }

  async status({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)
    
    return response.ok({
      id: video.id,
      title: video.title,
      status: video.status,
      duration: video.duration,
      resolution: video.resolution,
      extension: video.extension,
      fileSize: video.fileSize,
      uploadTime: video.uploadTime,
      uploadDuration: video.uploadDuration, // in milliseconds
      uploadDurationFormatted: video.uploadDuration 
        ? `${(video.uploadDuration / 1000).toFixed(2)}s` 
        : null,
      processingStartedAt: video.processingStartedAt,
      processingCompletedAt: video.processingCompletedAt,
      processingDuration: video.processingStartedAt && video.processingCompletedAt
        ? video.processingCompletedAt.diff(video.processingStartedAt, 'milliseconds').milliseconds
        : null,
      cloudinaryUrl: video.cloudinaryUrl,
      cloudinaryStreamingUrl: video.cloudinaryStreamingUrl,
      cloudinaryPublicId: video.cloudinaryPublicId,
      audioReady: !!video.audioPath,
      cleanAudioReady: !!video.cleanAudioPath,
      thumbnailReady: !!video.thumbnailPath,
      subtitlesReady: !!video.subtitlePath,
      errorMessage: video.errorMessage,
    })
  }

 async downloadSubtitles({ params, response }: HttpContext) {
  const video = await Video.findOrFail(params.id)

  if (!video.subtitlePath) {
    return response.notFound({ error: 'Subtitles not available' })
  }

  const filePath = app.makePath('storage', video.subtitlePath)

  if (!existsSync(filePath)) {
    return response.notFound({ error: 'File not found' })
  }

  let content = fs.readFileSync(filePath, 'utf-8')

  content =
    'WEBVTT\n\n' +
    content
      .replace(/\r+/g, '')
      .replace(/^\d+\n/gm, '')  
      .replace(/,/g, '.')      

  response.header('Content-Type', 'text/vtt; charset=utf-8')
  response.header('Access-Control-Allow-Origin', '*')

  return response.send(content)
}


  async destroy({ params, auth, response }: HttpContext) {
    // const user = await auth.authenticate()
    const video = await Video.query()
      .where('id', params.id)
      .where('user_id', 1)
      .firstOrFail()

    try {
      await drive.use().delete(video.storagePath)
      if (video.audioPath) await drive.use().delete(video.audioPath)
      if (video.cleanAudioPath) await drive.use().delete(video.cleanAudioPath)
      if (video.thumbnailPath) await drive.use().delete(video.thumbnailPath)
      if (video.subtitlePath) await drive.use().delete(video.subtitlePath)
    } catch (err) {
      console.warn('⚠️  File deletion warning:', err.message)
    }

    await video.delete()
    return response.ok({ message: 'Video deleted successfully' })
  }

  async convert({ request, response }: HttpContext) {
    const {
      fileName,
      outputFormat,
      quality    = 'medium',
      resolution,
      filters,
    } = request.only(['fileName', 'outputFormat', 'quality', 'resolution', 'filters'])
    if (!fileName || !outputFormat) {
      return response.badRequest({ error: 'fileName and outputFormat are required' })
    }

    if (!SUPPORTED_FORMATS.includes(outputFormat.toLowerCase())) {
      return response.badRequest({
        error: `Invalid outputFormat. Choose from: ${SUPPORTED_FORMATS.join(', ')}`,
      })
    }

    if (!SUPPORTED_QUALITIES.includes(quality)) {
      return response.badRequest({
        error: `Invalid quality. Choose from: ${SUPPORTED_QUALITIES.join(', ')}`,
      })
    }

    if (resolution && !SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return response.badRequest({
        error: `Invalid resolution. Choose from: ${SUPPORTED_RESOLUTIONS.join(', ')} or omit`,
      })
    }

    if (filters) {
      const validationErrors = this.validateFilters(filters)
      if (validationErrors.length > 0) {
        return response.badRequest({ error: 'Invalid filters', details: validationErrors })
      }
    }

    const service = new VideoService()

    const result = await service.convertVideo({
      fileName,
      outputFormat: outputFormat.toLowerCase(),
      quality,
      resolution,
      filters: filters as AdvancedFilters | undefined,
    })

    return response.ok({
      message: 'Video converted successfully',
      data: result,
    })
  }

  async uploadAndConvert({ request, response }: HttpContext) {
    const videoFile = request.file('video', {
      size: '2gb',
      extnames: SUPPORTED_FORMATS,
    })

    if (!videoFile || !videoFile.isValid) {
      return response.badRequest({
        error: videoFile ? videoFile.errors : 'No video file provided',
      })
    }

    const {
      outputFormat,
      quality    = 'medium',
      resolution,
      filters,
    } = request.only(['outputFormat', 'quality', 'resolution', 'filters'])

    if (!outputFormat) {
      return response.badRequest({ error: 'outputFormat is required' })
    }

    const fileName  = `${cuid()}.${videoFile.extname}`
    const uploadDir = app.makePath('storage/videos/uploads')
    const rawPath   = path.join(uploadDir, fileName)

    await videoFile.move(uploadDir, { name: fileName })

    const service = new VideoService()
    await service.compressFile(rawPath)

    const result = await service.convertVideo({
      fileName,
      outputFormat: outputFormat.toLowerCase(),
      quality,
      resolution,
      filters: filters as AdvancedFilters | undefined,
    })

    return response.ok({
      message: 'Video uploaded, converted, and stored compressed',
      data: result,
    })
  }

  async download({ params, request, response }: HttpContext) {
    // const wildcardParts = params['*']
    // const fileName = Array.isArray(wildcardParts)
    //   ? wildcardParts.join('/')
    //   : (wildcardParts ?? '')
    const fileName = params.fileName

    if (!fileName) {
      return response.badRequest({ error: 'fileName is required in the URL' })
    }

    const source = (request.qs().source || 'converted') as 'uploads' | 'converted'

    const storageDir = source === 'uploads'
      ? app.makePath('storage/videos/uploads')
      : app.makePath('storage/videos/converted')

    const expectedGzPath = path.join(storageDir, `${fileName}.gz`)

    if (!existsSync(expectedGzPath)) {
      return response.notFound({
        error:  'File not found',
        detail: `No compressed file found: ${fileName}.gz in storage/videos/${source}/`,
        hint:   'Use the exact fileName from /upload or convertedFile from /convert',
      })
    }

    const service = new VideoService()
    let tempPath: string | null = null

    try {
      tempPath = await service.prepareForDownload(fileName, source)

      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'mp4'
      const mimeMap: Record<string, string> = {
        mp4:  'video/mp4',
        mkv:  'video/x-matroska',
        webm: 'video/webm',
        avi:  'video/x-msvideo',
        mov:  'video/quicktime',
        flv:  'video/x-flv',
        wmv:  'video/x-ms-wmv',
        mpeg: 'video/mpeg',
      }

      response.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream')
      response.header('Content-Disposition', `attachment; filename="${fileName}"`)

      await response.download(tempPath)

    } finally {
      // if (tempPath && existsSync(tempPath)) {
      //   await unlink(tempPath).catch(() => {})
      // }
    }
  }

  private validateFilters(filters: any): string[] {
    const errors: string[] = []

    if (filters.brightness !== undefined) {
      if (typeof filters.brightness !== 'number' || filters.brightness < -1 || filters.brightness > 1) {
        errors.push('brightness must be between -1.0 and 1.0')
      }
    }

    if (filters.contrast !== undefined) {
      if (typeof filters.contrast !== 'number' || filters.contrast < 0 || filters.contrast > 3) {
        errors.push('contrast must be between 0.0 and 3.0')
      }
    }

    if (filters.saturation !== undefined) {
      if (typeof filters.saturation !== 'number' || filters.saturation < 0 || filters.saturation > 3) {
        errors.push('saturation must be between 0.0 and 3.0')
      }
    }

    if (filters.gamma !== undefined) {
      if (typeof filters.gamma !== 'number' || filters.gamma < 0.1 || filters.gamma > 3) {
        errors.push('gamma must be between 0.1 and 3.0')
      }
    }

    if (filters.sharpen !== undefined) {
      if (typeof filters.sharpen !== 'number' || filters.sharpen < 0 || filters.sharpen > 10) {
        errors.push('sharpen must be between 0 and 10')
      }
    }

    if (filters.denoise !== undefined) {
      if (typeof filters.denoise !== 'number' || filters.denoise < 0 || filters.denoise > 10) {
        errors.push('denoise must be between 0 and 10')
      }
    }

    if (filters.blur !== undefined) {
      if (typeof filters.blur !== 'number' || filters.blur < 0 || filters.blur > 10) {
        errors.push('blur must be between 0 and 10')
      }
    }

    if (filters.vignette !== undefined) {
      if (typeof filters.vignette !== 'number' || filters.vignette < 0 || filters.vignette > 1) {
        errors.push('vignette must be between 0.0 and 1.0')
      }
    }

    if (filters.rotate !== undefined) {
      if (![0, 90, 180, 270].includes(filters.rotate)) {
        errors.push('rotate must be 0, 90, 180, or 270')
      }
    }

    if (filters.colorTemp !== undefined) {
      if (typeof filters.colorTemp !== 'number' || filters.colorTemp < -100 || filters.colorTemp > 100) {
        errors.push('colorTemp must be between -100 and 100')
      }
    }

    if (filters.vibrance !== undefined) {
      if (typeof filters.vibrance !== 'number' || filters.vibrance < 0 || filters.vibrance > 2) {
        errors.push('vibrance must be between 0.0 and 2.0')
      }
    }

    return errors
  }
}