import { BaseCommand, args } from '@adonisjs/core/ace'
import Video from '#models/video'
import app from '@adonisjs/core/services/app'
import { AudioService } from '#services/audio_service'
import { DateTime } from 'luxon'
import { existsSync } from 'node:fs'

export default class ManualProcessVideo extends BaseCommand {
  static commandName = 'video:process'
  static description = 'Manually process a video'

  @args.string({ description: 'Video ID' })
  declare videoId: string

  async run() {
    const id = Number(this.videoId)

    console.log(`\n Processing Video ID: ${id}\n`)

    try {
      const video = await Video.findOrFail(id)
      const audioService = new AudioService()
      const storagePath = app.makePath('storage', video.storagePath)

      console.log(`Video: ${video.title}`)
      console.log(`Status: ${video.status}`)
      console.log(`Path: ${storagePath}`)
      console.log(`File exists: ${existsSync(storagePath)}\n`)

      if (!existsSync(storagePath)) {
        throw new Error(`Video file not found: ${storagePath}`)
      }

      await video.merge({
        status: 'processing',
        processingStartedAt: DateTime.now(),
      }).save()

      console.log('Extracting metadata...')
      const meta = await audioService.getMetadata(storagePath)

      await video.merge({
        duration: meta.duration,
        resolution: meta.resolution,
      }).save()

      await video.merge({
        status: 'ready',
        processingCompletedAt: DateTime.now(),
      }).save()

      console.log('Processing complete!')
    } catch (error: any) {
      console.error('Processing failed:', error.message)
    }
  }
}
