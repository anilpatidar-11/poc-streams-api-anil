import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, statSync, existsSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import Video from '#models/video'
import { AudioService } from '#services/audio_service'

export default class AudioController {

  async download({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)

    if (!video.audioPath) {
      return response.notFound({ error: 'Audio not yet extracted. Check /status first.' })
    }

    const absolutePath = app.makePath('storage', video.audioPath)

    if (!existsSync(absolutePath)) {
      return response.notFound({ error: 'Audio file missing from disk' })
    }

    response.header('Content-Type', 'audio/mpeg')
    response.header('Content-Disposition', `attachment; filename="${video.title}_audio.mp3"`)
    return response.stream(createReadStream(absolutePath))
  }

  async downloadClean({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)

    if (!video.cleanAudioPath) {
      return response.notFound({ error: 'Clean audio not yet processed. Check /status first.' })
    }

    const absolutePath = app.makePath('storage', video.cleanAudioPath)

    if (!existsSync(absolutePath)) {
      return response.notFound({ error: 'Clean audio file missing from disk' })
    }

    response.header('Content-Type', 'audio/mpeg')
    response.header('Content-Disposition', `attachment; filename="${video.title}_clean_audio.mp3"`)
    return response.stream(createReadStream(absolutePath))
  }

  async processAudio({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)
    const audioService = new AudioService()

    const videoAbsPath = app.makePath('storage', video.storagePath)

    if (!existsSync(videoAbsPath)) {
      return response.notFound({ error: 'Source video file not found' })
    }

    try {
      const audioRelPath = video.storagePath.replace(/\.[^.]+$/, '_audio.mp3')
      const audioAbsPath = app.makePath('storage', audioRelPath)
      await audioService.extractAudio(videoAbsPath, audioAbsPath)

      const cleanRelPath = video.storagePath.replace(/\.[^.]+$/, '_clean.mp3')
      const cleanAbsPath = app.makePath('storage', cleanRelPath)
      await audioService.removeNoise(audioAbsPath, cleanAbsPath)

      await video.merge({
        audioPath: audioRelPath,
        cleanAudioPath: cleanRelPath,
        status: 'ready',
      }).save()

      return response.ok({
        message: 'Audio processing complete',
        audioUrl: `/api/videos/${video.id}/audio`,
        cleanAudioUrl: `/api/videos/${video.id}/audio/clean`,
      })

    } catch (error) {
      await video.merge({ status: 'failed', errorMessage: error.message }).save()
      return response.internalServerError({
        error: 'Audio processing failed',
        details: error.message,
        hint: 'Make sure FFmpeg is installed: ffmpeg -version'
      })
    }
  }
}