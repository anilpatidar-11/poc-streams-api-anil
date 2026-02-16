import 'reflect-metadata'
import { Ignitor } from '@adonisjs/core'
import { existsSync } from 'node:fs'

const APP_ROOT = new URL('../../', import.meta.url)
const VIDEO_ID = process.argv[2]

if (!VIDEO_ID || isNaN(Number(VIDEO_ID))) {
  console.error('❌ Usage: node build/scripts/process_video.js <video_id>')
  process.exit(1)
}

async function processVideo() {
  const ignitor = new Ignitor(APP_ROOT, { importer: (filePath) => import(filePath) })
  const app = ignitor.createApp('console')
  await app.init()
  await app.boot()

  const { default: Video } = await import('#models/video')
  const { AudioService } = await import('#services/audio_service')
  const { DateTime } = await import('luxon')
  const appService = await import('@adonisjs/core/services/app')

  const id = Number(VIDEO_ID)
  console.log(`\n🎬 Processing Video ID: ${id}\n`)

  try {
    const video = await Video.findOrFail(id)
    const audioService = new AudioService()
    const storagePath = appService.default.makePath('storage', video.storagePath)

    if (!existsSync(storagePath)) {
      throw new Error(`Video file not found: ${storagePath}`)
    }

    await video.merge({ status: 'processing', processingStartedAt: DateTime.now() }).save()

    // Metadata
    console.log('📊 Extracting metadata...')
    const meta = await audioService.getMetadata(storagePath)
    await video.merge({ duration: meta.duration, resolution: meta.resolution }).save()
    console.log(`✅ ${meta.duration}s, ${meta.resolution}\n`)

    // Audio
    console.log('🎵 Extracting audio...')
    const audioPath = video.storagePath.replace(/\.[^.]+$/, '_audio.mp3')
    await audioService.extractAudio(storagePath, appService.default.makePath('storage', audioPath))
    await video.merge({ audioPath }).save()
    console.log(`✅ Done\n`)

    // Clean audio
    console.log('🔇 Noise cancellation...')
    const cleanPath = video.storagePath.replace(/\.[^.]+$/, '_clean.mp3')
    await audioService.removeNoise(
      appService.default.makePath('storage', audioPath),
      appService.default.makePath('storage', cleanPath)
    )
    await video.merge({ cleanAudioPath: cleanPath }).save()
    console.log(`✅ Done\n`)

    // Thumbnail
    console.log('🖼️  Generating thumbnail...')
    const thumbPath = video.storagePath.replace(/\.[^.]+$/, '_thumb.jpg')
    try {
      await audioService.generateThumbnail(storagePath, appService.default.makePath('storage', thumbPath))
      if (existsSync(appService.default.makePath('storage', thumbPath))) {
        await video.merge({ thumbnailPath: thumbPath }).save()
        console.log(`✅ Done\n`)
      }
    } catch (e) {
      console.log(`⚠️  Failed\n`)
    }

    // Subtitles
    console.log('📝 Generating subtitles...')
    const subPath = video.storagePath.replace(/\.[^.]+$/, '.srt')
    const subAbsPath = appService.default.makePath('storage', subPath)
    try {
      await audioService.generateSubtitles(storagePath, subAbsPath)
      if (existsSync(subAbsPath)) {
        await video.merge({ subtitlePath: subPath }).save()
        console.log(`✅ Done\n`)
      }
    } catch (e: any) {
      console.log(`❌ Failed: ${e.message}\n`)
    }

    await video.merge({ status: 'ready', processingCompletedAt: DateTime.now() }).save()
    console.log('✅ Processing complete!\n')

    const final = await Video.findOrFail(id)
    console.log('Final Status:')
    console.log(`  Subtitles: ${final.subtitlePath ? '✅' : '❌'}`)
    
    process.exit(0)
  } catch (error: any) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}

processVideo()