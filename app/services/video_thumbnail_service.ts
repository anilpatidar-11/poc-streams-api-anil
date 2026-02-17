import fs from 'fs/promises'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import app from '@adonisjs/core/services/app'

if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic)
}

// ── Interfaces ────────────────────────────────────────────────

export interface SpriteInfo {
    path: string
    columns: number
    rows: number
    thumbWidth: number
    thumbHeight: number
    spriteWidth: number
    spriteHeight: number
}

export interface ThumbnailMeta {
    frameNo: number
    timeSecond: number
    timeLabel: string
}

export interface UploadVideoResult {
    videoId: string
    fileName: string
    videoUrl: string
    posterUrl: string
    duration: number
    durationFormatted: string
    thumbnailCount: number
    interval: number
    intervalLabel: string
    sprite: SpriteInfo
    thumbnails: ThumbnailMeta[]
}

// ── Service ───────────────────────────────────────────────────

export default class VideoThumbnailService {

    // ── Main: Upload video + generate sprite ──────────────────────
    async processVideoUpload(
        videoFile: any,
        customThumbnailFile?: any
    ): Promise<UploadVideoResult> {
        console.log('🎬 Starting video upload...')

        // 1. Save video
        const uploadDir = app.publicPath('uploads/videos')
        await fs.mkdir(uploadDir, { recursive: true })

        const fileName = `${Date.now()}-${uuid()}.mp4`
        await videoFile.move(uploadDir, { name: fileName })

        const videoPath = path.join(uploadDir, fileName)
        const videoUrl = `/uploads/videos/${fileName}`
        console.log(`✅ Video saved: ${videoPath}`)

        // 2. Get duration
        const duration = await this.getVideoDuration(videoPath)
        console.log(`📹 Duration: ${duration}s (${this.formatTime(duration)})`)
        if (duration <= 0) throw new Error('Invalid video duration')

        // 3. Calculate frames and interval
        const { frameCount, interval } = this.calculateFrameCount(duration)
        console.log(`🎯 Frame Count: ${frameCount} (every ${interval.toFixed(2)}s)`)

        // 4. Create thumbnail folder
        const videoFolderId = uuid()
        const thumbnailDir = app.publicPath(`thumbnails/${videoFolderId}`)
        await fs.mkdir(thumbnailDir, { recursive: true })

        // 5. Generate sprite (single ffmpeg tile command — fast!)
        console.log('🚀 Generating sprite with ffmpeg...')
        const spriteInfo = await this.generateSprite(
            videoPath,
            thumbnailDir,
            videoFolderId,
            frameCount,
            interval
        )
        console.log(`✅ Sprite generated: ${spriteInfo.columns}x${spriteInfo.rows}`)

        // 6. Handle optional custom poster
        let posterUrl = ''
        if (customThumbnailFile) {
            const posterName = `poster.webp`
            await customThumbnailFile.move(thumbnailDir, { name: posterName })
            posterUrl = `/thumbnails/${videoFolderId}/${posterName}`
            console.log('✅ Custom poster saved')
        }

        // 7. Build thumbnail metadata (time info only, no image paths needed — sprite handles display)
        const thumbnails: ThumbnailMeta[] = Array.from({ length: frameCount }, (_, i) => {
            const timeSecond = Number((i * interval).toFixed(2))
            return {
                frameNo: i + 1,
                timeSecond,
                timeLabel: this.formatTime(timeSecond),
            }
        })

        return {
            videoId: videoFolderId,
            fileName: videoFile.clientName,
            videoUrl,
            posterUrl,
            duration,
            durationFormatted: this.formatTime(duration),
            thumbnailCount: frameCount,
            interval,
            intervalLabel: interval === 1 ? '1 per second' : `every ${interval.toFixed(2)}s`,
            sprite: spriteInfo,
            thumbnails,
        }
    }

    // ── Get files for a video ─────────────────────────────────────
    async getVideoFiles(videoId: string): Promise<string[]> {
        const thumbnailDir = app.publicPath(`thumbnails/${videoId}`)
        const files = await fs.readdir(thumbnailDir)
        console.log(`🔍 Found ${files.length} files for video ${videoId}`)
        return files.map((f) => `/thumbnails/${videoId}/${f}`)
    }

    // ── Get all processed videos ──────────────────────────────────
    async getAllVideos(): Promise<{ videoId: string; fileCount: number }[]> {
        const thumbnailDir = app.publicPath('thumbnails')
        const videos = await fs.readdir(thumbnailDir)
        console.log(`📺 Found ${videos.length} processed videos`)

        return Promise.all(
            videos.map(async (videoId) => {
                const files = await fs.readdir(path.join(thumbnailDir, videoId))
                return { videoId, fileCount: files.length }
            })
        )
    }

    // ── Private: Generate sprite sheet via ffmpeg tile filter ──────
    // Single command: fps filter → scale → tile → one image (10x faster than frame-by-frame)
    private generateSprite(
        videoPath: string,
        outputDir: string,
        videoId: string,
        frameCount: number,
        interval: number
    ): Promise<SpriteInfo> {
        return new Promise((resolve, reject) => {
            const thumbWidth = 160
            const thumbHeight = 90
            const columns = 5
            const rows = Math.ceil(frameCount / columns)
            const spritePath = path.join(outputDir, 'sprite.jpg')

            // fps = 1/interval
            // interval=1  → fps=1.0  (1 frame per sec)
            // interval=2  → fps=0.5  (1 frame every 2 sec)
            const fps = 1 / interval

            ffmpeg(videoPath)
                .outputOptions([
                    `-vf fps=${fps},scale=${thumbWidth}:${thumbHeight},tile=${columns}x${rows}`,
                    '-frames:v 1',
                    '-q:v 3',           // quality (1-31, lower = better)
                ])
                .output(spritePath)
                .on('end', async () => {
                    try {
                        console.log('✅ Sprite jpg ready, converting to webp...')

                        // Convert jpg → webp (smaller size)
                        const webpPath = path.join(outputDir, 'sprite.webp')
                        await sharp(spritePath)
                            .webp({ quality: 80 })
                            .toFile(webpPath)

                        // Remove temp jpg
                        await fs.unlink(spritePath).catch(() => { })

                        resolve({
                            path: `/thumbnails/${videoId}/sprite.webp`,
                            columns,
                            rows,
                            thumbWidth,
                            thumbHeight,
                            spriteWidth: thumbWidth * columns,
                            spriteHeight: thumbHeight * rows,
                        })
                    } catch (err) {
                        reject(err)
                    }
                })
                .on('error', (err) => {
                    console.error('❌ Sprite generation error:', err)
                    reject(err)
                })
                .run()
        })
    }

    // ── Private: Get video duration via ffprobe ───────────────────
    private getVideoDuration(videoPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) return reject(err)
                resolve(metadata.format.duration || 0)
            })
        })
    }

    // ── Private: Calculate frame count based on duration ─────────
    private calculateFrameCount(duration: number): { frameCount: number; interval: number } {
        let frameCount: number
        let interval: number

        if (duration < 60) {
            frameCount = Math.ceil(duration)
            interval = 1
        } else if (duration < 600) {
            frameCount = Math.ceil(duration / 2)
            interval = 2
        } else if (duration < 3600) {
            frameCount = Math.ceil(duration / 5)
            interval = 5
        } else if (duration < 7200) {
            frameCount = Math.ceil(duration / 10)
            interval = 10
        } else {
            frameCount = 500
            interval = duration / 500
        }

        return { frameCount, interval }
    }

    // ── Private: Format seconds → HH:MM:SS or MM:SS ──────────────
    private formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = Math.floor(seconds % 60)

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
}