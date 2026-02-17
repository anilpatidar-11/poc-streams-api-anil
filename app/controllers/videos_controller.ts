import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import drive from '@adonisjs/drive/services/main'
import Video from '#models/video'
import { videoProcessingQueue } from '#services/queue_service'
import fs from 'node:fs'
import type { VideoQuality, VideoResolution, EnhanceType } from '#services/video_service'
import VideoService from '#services/video_service'
import { cuid } from '@adonisjs/core/helpers'
import { unlink } from 'node:fs/promises'
import path from 'node:path'

// ─── Validation constants ─────────────────────────────────────────────────────

const SUPPORTED_FORMATS: string[]         = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpeg']
const SUPPORTED_QUALITIES: VideoQuality[] = ['lossless', 'high', 'medium', 'low']
const SUPPORTED_RESOLUTIONS: VideoResolution[] = ['360p', '480p', '720p', '1080p', '1440p', '4k']
const SUPPORTED_ENHANCES: EnhanceType[]   = ['denoise', 'sharpen', 'stabilize', 'hdr', 'none']

export default class VideosController {

  async index({ auth, response }: HttpContext) {
    // const user = await auth.authenticate()
    const videos = await Video.query()
      .where('user_id', 1)
      .orderBy('created_at', 'desc')
    return response.ok({ count: videos.length, videos })
  }

  async show({ params, auth, response }: HttpContext) {
    // const user = await auth.authenticate()
    const video = await Video.query()
      .where('id', params.id)
      .where('user_id', 1)
      .firstOrFail()
    return response.ok({ video })
  }

  async upload({ request, auth, response }: HttpContext) {
    // const user = await auth.authenticate()

    const uploadStartTime = Date.now()
    // ───────────────────────────────────────────────────────────

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
    const storagePath = `videos/1/${Date.now()}.${ext}`
    
    await videoFile.moveToDisk(storagePath)

    const uploadEndTime = Date.now()
    const uploadDuration = uploadEndTime - uploadStartTime

    const video = await Video.create({
      userId: 1,
      title: request.input('title', videoFile.clientName),
      originalFilename: videoFile.clientName || 'unknown',
      storagePath,
      fileSize: videoFile.size || 0,
      mimeType: `video/${ext}`,
      status: 'uploaded',
      extension: ext,
      uploadTime: DateTime.now(),
      uploadDuration, 
    })

    try {
      await videoProcessingQueue?.add('process-video', {
        videoId: video.id,
        storagePath: app.makePath('storage', storagePath),
      })
      await video.merge({ status: 'processing' }).save()
    } catch {}

    return response.created({
      message: 'Video uploaded',
      video: {
        id: video.id,
        title: video.title,
        extension: ext,
        uploadTime: video.uploadTime,
        uploadDuration: uploadDuration, 
        uploadDurationSeconds: (uploadDuration / 1000).toFixed(2), 
        status: video.status
      }
    })
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
      enhance    = 'none',
    } = request.only(['fileName', 'outputFormat', 'quality', 'resolution', 'enhance'])

    // Validate required
    if (!fileName || !outputFormat) {
      return response.badRequest({ error: 'fileName and outputFormat are required' })
    }

    // Validate format
    if (!SUPPORTED_FORMATS.includes(outputFormat.toLowerCase())) {
      return response.badRequest({
        error: `Invalid outputFormat. Choose from: ${SUPPORTED_FORMATS.join(', ')}`,
      })
    }

    // Validate quality
    if (!SUPPORTED_QUALITIES.includes(quality)) {
      return response.badRequest({
        error: `Invalid quality. Choose from: ${SUPPORTED_QUALITIES.join(', ')}`,
      })
    }

    // Validate resolution (optional)
    if (resolution && !SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return response.badRequest({
        error: `Invalid resolution. Choose from: ${SUPPORTED_RESOLUTIONS.join(', ')} — or omit to keep original`,
      })
    }

    // Validate enhance (optional)
    if (enhance && !SUPPORTED_ENHANCES.includes(enhance)) {
      return response.badRequest({
        error: `Invalid enhance. Choose from: ${SUPPORTED_ENHANCES.join(', ')}`,
      })
    }

    const service = new VideoService()

    const result = await service.convertVideo({
      fileName,
      outputFormat: outputFormat.toLowerCase(),
      quality,
      resolution,   // undefined = keep original resolution
      enhance,
    })

    return response.ok({
      message: 'Video converted successfully',
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

    const storageDir     = source === 'uploads'
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
}