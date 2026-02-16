import app from '@adonisjs/core/services/app'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { copyFileSync } from 'node:fs'

import { mkdirSync } from 'node:fs'

interface ConvertOptions {
  fileName: string
  quality: 'high' | 'mid' | 'low'
}

const execAsync = promisify(exec)

export default class VideoService {
  private formats = ['mp4', 'mov', 'mkv', 'webm']

  async convertVideo(options: ConvertOptions) {
    const { fileName, quality } = options

    const uploadsDir = app.makePath('storage/videos/uploads')
    const outputDir = app.makePath(`storage/videos/converted/${quality}`)

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const inputFilePath = path.join(uploadsDir, fileName)

    if (!existsSync(inputFilePath)) {
      throw new Error(`Source file not found: ${fileName}`)
    }

    const baseName = path.parse(fileName).name

    const results = this.formats.map((format) => {
      const outputFileName = `${baseName}_${quality}.${format}`
      const outputFilePath = path.join(outputDir, outputFileName)

      copyFileSync(inputFilePath, outputFilePath)

      return {
        format,
        fileName: outputFileName,
        quality,
        streamUrl: `/videos/stream/${quality}/${outputFileName}`,
        downloadUrl: `/videos/download/${quality}/${outputFileName}`,
      }
    })

    return {
      originalFile: fileName,
      quality,
      convertedAt: new Date().toISOString(),
      files: results,
    }
  }


  async checkFFmpegInstalled(): Promise<boolean> {
    try {
      await execAsync('ffmpeg -version')
      return true
    } catch {
      return false
    }
  }
}
