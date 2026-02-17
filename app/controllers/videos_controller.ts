import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import drive from '@adonisjs/drive/services/main'
import Video from '#models/video'
import { videoProcessingQueue } from '#services/queue_service'
import fs from 'node:fs'
import { uploadVideoToCloudinary } from '#services/cloudinary_service'
import type { VideoQuality, VideoResolution, AdvancedFilters } from '#services/video_service'
import VideoService from '#services/video_service'
import { cuid } from '@adonisjs/core/helpers'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import ResponseHelper from '#helpers/response_helper'
─────────────────────────────────────────────────────

const SUPPORTED_FORMATS: string[] = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpeg']
const SUPPORTED_QUALITIES: VideoQuality[] = ['lossless', 'high', 'medium', 'low']
const SUPPORTED_RESOLUTIONS: VideoResolution[] = ['360p', '480p', '720p', '1080p', '1440p', '4k']

export default class VideosController {
  async index({ auth, response,i18n }: HttpContext) {
    // const user = await auth.authenticate()
    const videos = await Video.query().where('user_id', 1).orderBy('created_at', 'desc')

    const formattedVideos = videos.map((video) => ({
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

    return ResponseHelper.success(response, i18n.t('video.list_fetched'), {
      count: formattedVideos.length,
      videos: formattedVideos,
    })
  }

  async show({ params, auth, response, i18n }: HttpContext) {
    // const user = await auth.authenticate()
    const video = await Video.query().where('id', params.id).where('user_id', 1).firstOrFail()

    return ResponseHelper.success(response, i18n.t('video.details_fetched'), {
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
      },
    })
  }

  async upload({ request, auth, response ,i18n}: HttpContext) {
    // const user = await auth.authenticate()
    const userId = 1
    const uploadStartTime = Date.now()

    const videoFile = request.file('video', {
      extnames: ['mp4', 'avi', 'mov', 'mkv', 'webm'],
      size: '2gb',
    })

  if (!videoFile || !videoFile.isValid) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_file'),
      videoFile?.errors
    )
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
      videoProcessingQueue
        ?.add('process-video', {
          videoId: video.id,
          storagePath: filePath,
        })
        .catch((err) => console.error('Queue error:', err))

      // Return with streaming URL
    return ResponseHelper.created(
      response,
      i18n.t('video.upload_success'),
      {
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
        },
      })
    } catch (err) {
      console.error('Cloudinary upload failed:', err)
      video.status = 'failed'
      video.errorMessage = 'Cloudinary upload failed'
      await video.save()

     return ResponseHelper.serverError(
      response,
      i18n.t('video.cloudinary_failed'),
      {
        video: {
          id: video.id,
          status: 'failed',
        },
        error: err.message,
      }
    )
  }
}

  async uploadVideoConvert({ request, auth, response ,i18n}: HttpContext) {
    // const user = await auth.authenticate()
    const userId = 1

    // ── 1. Validate incoming file ─────────────────────────────────────────
    const videoFile = request.file('video', {
      size: '2gb',
      extnames: SUPPORTED_FORMATS,
    })

     if (!videoFile) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_file')
    )
  }

  if (!videoFile.isValid) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_file'),
      videoFile.errors
    )
  }

    // ── 2. Run full pipeline: compress → upload → persist ─────────────────
    const service = new VideoService()

    try {
      const video = await service.ingestUpload(videoFile, userId, request.input('title'))

      // ── 3. Respond with everything the client needs ───────────────────────
   return ResponseHelper.created(
      response,
      i18n.t('video.upload_success'),
    {
          id: video.id,
          title: video.title,
          originalName: video.originalFilename,
          extension: video.extension,
          size: video.fileSize,
          duration: video.duration,
          status: video.status,
          cloudinaryUrl: video.cloudinaryUrl,
          cloudinaryStreamingUrl: video.cloudinaryStreamingUrl,
          cloudinaryPublicId: video.cloudinaryPublicId,
          uploadedAt: video.uploadTime,
        },
      )
    } catch (error) {
      console.error('Upload pipeline failed:', error)

    return ResponseHelper.serverError(
      response,
      i18n.t('video.upload_failed'),
      error.message
    )
  }
}


  async uploadMultiple({ request, auth, response ,i18n}: HttpContext) {
    const user = await auth.authenticate()
    const videoFiles = request.files('videos', {
      extnames: ['mp4', 'avi', 'mov', 'mkv', 'webm'],
      size: '2gb',
    })

const uploaded: any[] = []
  const failed: any[] = []

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
          storagePath: app.makePath('storage', path),
        })
        await video.merge({ status: 'processing' }).save()
      } catch {}

      uploaded.push({
        id: video.id,
        title: video.title,
        uploadDuration: `${(uploadDuration / 1000).toFixed(2)}s`,
      })
    }

  return ResponseHelper.created(
    response,
    i18n.t('video.multiple_uploaded', {
      count: uploaded.length,
    }),
    {
      uploaded,
      failed,
    }
  )
}


  async stream({ params, request, response,i18n }: HttpContext) {
    const video = await Video.findOrFail(params.id)
    const path = app.makePath('storage', video.storagePath)
  if (!existsSync(path)) {
    return ResponseHelper.notFound(
      response,
      i18n.t('video.file_not_found')
    )
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

  async status({ params, response,i18n }: HttpContext) {
    const video = await Video.findOrFail(params.id)

   return ResponseHelper.success(
    response,
    i18n.t('video.status_fetched'),
    {
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
      processingDuration:
        video.processingStartedAt && video.processingCompletedAt
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

  async downloadSubtitles({ params, response,i18n }: HttpContext) {
    const video = await Video.findOrFail(params.id)

    if (!video.subtitlePath) {
    return ResponseHelper.notFound(
      response,
      i18n.t('video.subtitles_not_available')
    )
  }

    const filePath = app.makePath('storage', video.subtitlePath)

    if (!existsSync(filePath)) {
    return ResponseHelper.notFound(
      response,
      i18n.t('video.subtitles_file_missing')
    )
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

  // async destroy({ params, auth, response }: HttpContext) {
  //   // const user = await auth.authenticate()
  //   const video = await Video.query()
  //     .where('id', params.id)
  //     .where('user_id', 1)
  //     .firstOrFail()

  //   try {
  //     await drive.use().delete(video.storagePath)
  //     if (video.audioPath) await drive.use().delete(video.audioPath)
  //     if (video.cleanAudioPath) await drive.use().delete(video.cleanAudioPath)
  //     if (video.thumbnailPath) await drive.use().delete(video.thumbnailPath)
  //     if (video.subtitlePath) await drive.use().delete(video.subtitlePath)
  //   } catch (err) {
  //     console.warn('⚠️  File deletion warning:', err.message)
  //   }

  //   await video.delete()
  //   return response.ok({ message: 'Video deleted successfully' })
  // }

  async destroy({ params, response ,i18n }: HttpContext) {
    const service = new VideoService()
    await service.removeVideo(params.publicId)

  return ResponseHelper.success(
    response,
    i18n.t('video.deleted_success')
  )
}

  async convert({ request, response,i18n }: HttpContext) {
    const {
      videoId,
      outputFormat,
      quality = 'medium',
      resolution,
      filters,
    } = request.only(['videoId', 'outputFormat', 'quality', 'resolution', 'filters'])

   if (!videoId || !outputFormat) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.file_and_format_required')
    )
  }

   if (!SUPPORTED_FORMATS.includes(outputFormat.toLowerCase())) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_format', {
        formats: SUPPORTED_FORMATS.join(', '),
      })
    )
  }

   if (!SUPPORTED_QUALITIES.includes(quality)) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_quality', {
        qualities: SUPPORTED_QUALITIES.join(', '),
      })
    )
  }

   if (resolution && !SUPPORTED_RESOLUTIONS.includes(resolution)) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_resolution', {
        resolutions: SUPPORTED_RESOLUTIONS.join(', '),
      })
    )
  }

    if (filters) {
      const validationErrors = this.validateFilters(filters)
      if (validationErrors.length > 0) {
        return ResponseHelper.badRequest(
        response,
        i18n.t('video.invalid_enhance'),
        validationErrors
      )
    }
  }


    const service = new VideoService()

    try {
      const result = await service.convertVideo({
        videoId: Number(videoId),
        outputFormat: outputFormat.toLowerCase(),
        quality,
        resolution,
        filters: filters as AdvancedFilters | undefined,
      })
    return ResponseHelper.success(
      response,
      i18n.t('video.convert_success'),
      result
    )
    } catch (error) {
      console.error('Convert failed:', error)
      return ResponseHelper.serverError(
      response,
      i18n.t('video.convert_failed'),
      error.message
    )
  }
}

  // ─── uploadAndConvert (local only, no Cloudinary) ────────────────────────────

  async uploadAndConvert({ request, response ,i18n }: HttpContext) {
    const videoFile = request.file('video', {
      size: '2gb',
      extnames: SUPPORTED_FORMATS,
    })

    if (!videoFile || !videoFile.isValid) {
      return ResponseHelper.badRequest(
      response,
      i18n.t('video.invalid_file'),
      videoFile ? videoFile.errors : null
    )
  }

    const {
      outputFormat,
      quality = 'medium',
      resolution,
      filters,
    } = request.only(['outputFormat', 'quality', 'resolution', 'filters'])

  if (!outputFormat) {
    return ResponseHelper.badRequest(
      response,
      i18n.t('video.file_and_format_required')
    )
  }

    const service = new VideoService()

    try {
      const result = await service.ingestAndConvert(
        videoFile,
        outputFormat.toLowerCase(),
        quality,
        resolution,
        filters as AdvancedFilters | undefined
      )

       return ResponseHelper.success(
      response,
      i18n.t('video.convert_success'),
      result
    )
    } catch (error) {
      console.error('uploadAndConvert failed:', error)
     return ResponseHelper.serverError(
      response,
      i18n.t('video.convert_failed'),
      error.message
    )
  }
}

  // ─── download — fetches .gz from Cloudinary, decompresses, sends to client ────
  //
  // Route: GET /videos/:id/download
  // :id is the DB id of the converted video record

  async download({ params, response,i18n }: HttpContext) {
    const service = new VideoService()
    let tempPath: string | null = null

    try {
      const { tempPath: tp, fileName, mimeType } = await service.prepareDownload(Number(params.id))
      tempPath = tp

      response.header('Content-Type', mimeType)
      response.header('Content-Disposition', `attachment; filename="${fileName}"`)

      await response.download(tempPath)
    } catch (error) {
      console.error('Download failed:', error)
    return ResponseHelper.serverError(
      response,
      i18n.t('video.download_failed'),
      error.message
    )
    } finally {
      // Delete temp decompressed file after response is sent
      // if (tempPath) {
      //   await unlink(tempPath).catch(() => { /* non-fatal */ })
      // }
    }
  }

  private validateFilters(filters: any, i18n: any): string[] {
    const errors: string[] = []

    if (
      filters.brightness !== undefined &&
      (typeof filters.brightness !== 'number' || filters.brightness < -1 || filters.brightness > 1)
    )
         errors.push(i18n.t('video.filters.brightness'))

    if (
      filters.contrast !== undefined &&
      (typeof filters.contrast !== 'number' || filters.contrast < 0 || filters.contrast > 3)
    )
   errors.push(i18n.t('video.filters.contrast'))

    if (
      filters.saturation !== undefined &&
      (typeof filters.saturation !== 'number' || filters.saturation < 0 || filters.saturation > 3)
    )
        errors.push(i18n.t('video.filters.saturation'))

    if (
      filters.gamma !== undefined &&
      (typeof filters.gamma !== 'number' || filters.gamma < 0.1 || filters.gamma > 3)
    )
         errors.push(i18n.t('video.filters.gamma'))

    if (
      filters.sharpen !== undefined &&
      (typeof filters.sharpen !== 'number' || filters.sharpen < 0 || filters.sharpen > 10)
    )
         errors.push(i18n.t('video.filters.sharpen'))

    if (
      filters.denoise !== undefined &&
      (typeof filters.denoise !== 'number' || filters.denoise < 0 || filters.denoise > 10)
    )
       errors.push(i18n.t('video.filters.denoise'))

    if (
      filters.blur !== undefined &&
      (typeof filters.blur !== 'number' || filters.blur < 0 || filters.blur > 10)
    )
         errors.push(i18n.t('video.filters.blur'))

    if (
      filters.vignette !== undefined &&
      (typeof filters.vignette !== 'number' || filters.vignette < 0 || filters.vignette > 1)
    )
         errors.push(i18n.t('video.filters.vignette'))
    if (filters.rotate !== undefined && ![0, 90, 180, 270].includes(filters.rotate))
          errors.push(i18n.t('video.filters.rotate'))

    if (
      filters.colorTemp !== undefined &&
      (typeof filters.colorTemp !== 'number' || filters.colorTemp < -100 || filters.colorTemp > 100)
    )
     errors.push(i18n.t('video.filters.colorTemp'))

    if (
      filters.vibrance !== undefined &&
      (typeof filters.vibrance !== 'number' || filters.vibrance < 0 || filters.vibrance > 2)
    )
      errors.push(i18n.t('video.filters.vibrance'))

    return errors
  }
}
