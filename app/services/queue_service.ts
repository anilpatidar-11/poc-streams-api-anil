import { Queue, Worker } from 'bullmq'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import Video from '#models/video'
import { AudioService } from '#services/audio_service'

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,  
}

let videoProcessingQueue: Queue | null = null
let videoWorker: Worker | null = null
let redisAvailable = false

try {
  videoProcessingQueue = new Queue('video-processing', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  })

  videoProcessingQueue.waitUntilReady()
    .then(() => {
      redisAvailable = true
      console.log('✅ Redis connected — Auto-processing enabled')
    })
    .catch((err) => {
      redisAvailable = false
      console.log('\n⚠️  Redis not available — Auto-processing disabled')
      console.log('   💡 Videos will upload but won\'t auto-process')
      console.log('   📝 Use: POST /api/videos/:id/audio/process\n')
    })

  videoWorker = new Worker(
    'video-processing',
    async (job) => {
      const { videoId, storagePath } = job.data
      const audioService = new AudioService()

      console.log(`[Worker PID ${process.pid}] Processing video ${videoId}`)

      const video = await Video.findOrFail(videoId)
      
      await video.merge({ 
        status: 'processing',
        processingStartedAt: DateTime.now()
      }).save()

      try {
        await job.updateProgress(10)
        console.log(`[Worker] Step 1/5: Extracting metadata...`)
        
        const meta = await audioService.getMetadata(storagePath)
        await video.merge({
          duration: meta.duration,
          resolution: meta.resolution,
        }).save()
        console.log(`✅ Metadata: ${meta.duration}s, ${meta.resolution}`)

        await job.updateProgress(30)
        console.log(`[Worker] Step 2/5: Extracting audio...`)
        
        const audioRelPath = video.storagePath.replace(/\.[^.]+$/, '_audio.mp3')
        const audioAbsPath = app.makePath('storage', audioRelPath)
        await audioService.extractAudio(storagePath, audioAbsPath)
        await video.merge({ audioPath: audioRelPath }).save()

        await job.updateProgress(50)
        console.log(`[Worker] Step 3/5: Noise cancellation...`)
        
        const cleanRelPath = video.storagePath.replace(/\.[^.]+$/, '_clean.mp3')
        const cleanAbsPath = app.makePath('storage', cleanRelPath)
        await audioService.removeNoise(audioAbsPath, cleanAbsPath)
        await video.merge({ cleanAudioPath: cleanRelPath }).save()

        await job.updateProgress(70)
        console.log(`[Worker] Step 4/5: Generating thumbnail...`)
        
        const thumbRelPath = video.storagePath.replace(/\.[^.]+$/, '_thumb.jpg')
        const thumbAbsPath = app.makePath('storage', thumbRelPath)
        try {
          await audioService.generateThumbnail(storagePath, thumbAbsPath)
          await video.merge({ thumbnailPath: thumbRelPath }).save()
        } catch {}

        await job.updateProgress(85)
        console.log(`[Worker] Step 5/5: Generating subtitles...`)
        
        const subRelPath = video.storagePath.replace(/\.[^.]+$/, '.srt')
        const subAbsPath = app.makePath('storage', subRelPath)
        try {
          await audioService.generateSubtitles(storagePath, subAbsPath)
          await video.merge({ subtitlePath: subRelPath }).save()
        } catch {}

        await job.updateProgress(100)
        await video.merge({ 
          status: 'ready',
          processingCompletedAt: DateTime.now()
        }).save()
        
        console.log(`✅ Video ${videoId} processing complete!`)

      } catch (error) {
        console.error(`❌ Processing failed:`, error.message)
        await video.merge({ 
          status: 'failed', 
          errorMessage: error.message,
          processingCompletedAt: DateTime.now()
        }).save()
        throw error
      }
    },
    { connection, concurrency: 3 }
  )

  videoWorker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`)
  })

  videoWorker.on('failed', async (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message)
  })

} catch (error) {
  console.log('⚠️  Queue initialization failed (Redis not available)')
  videoProcessingQueue = null
  videoWorker = null
}

export { videoProcessingQueue, videoWorker, redisAvailable }