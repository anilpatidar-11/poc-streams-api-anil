import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execAsync = promisify(exec)

export class AudioService {

  async extractAudio(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate(192)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  async removeNoise(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilters(['afftdn=nf=-25', 'highpass=f=80', 'lowpass=f=8000', 'dynaudnorm=p=0.9:s=5'])
        .audioCodec('libmp3lame')
        .audioBitrate(192)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  async getMetadata(videoPath: string): Promise<{ duration: number; resolution: string; hasAudio: boolean }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) return reject(err)
        const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
        const audioStream = metadata.streams.find((s) => s.codec_type === 'audio')
        resolve({
          duration: Math.round(metadata.format.duration || 0),
          resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : 'unknown',
          hasAudio: !!audioStream,
        })
      })
    })
  }

  async generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const filename = path.basename(outputPath)
      const dir = path.dirname(outputPath)
      ffmpeg(videoPath)
        .screenshots({ timestamps: ['10%'], filename: filename, folder: dir, size: '640x360' })
        .on('end', () => resolve())
        .on('error', reject)
    })
  }

  // ═══════════════════════════════════════════════════════════
  // SUBTITLE GENERATION - WSL/Windows Compatible
  // ═══════════════════════════════════════════════════════════

  async generateSubtitles(videoPath: string, outputPath: string): Promise<void> {
    console.log('🎬 Starting subtitle generation...')

    // Method 1: Try embedded
    const hasEmbedded = await this.extractEmbeddedSubtitles(videoPath, outputPath)
    if (hasEmbedded) {
      console.log('✅ Used embedded subtitles')
      return
    }

    const hasWhisper = await this.checkWhisperInstalled()
    if (hasWhisper) {
      console.log('🤖 Using Whisper AI for transcription...')
      await this.generateWithWhisper(videoPath, outputPath)
      return
    }

    console.log('⚠️  No Whisper found, creating placeholder subtitles')
    console.log('   To enable real transcription:')
    console.log('   1. Ubuntu: pip install openai-whisper')
    console.log('   2. Or Windows: pip install openai-whisper (in CMD)')
    await this.createPlaceholderSubtitles(outputPath)
  }

  /**
   * Check if Whisper is installed (Windows + WSL compatible)
   */
  private async checkWhisperInstalled(): Promise<boolean> {
    // Try 1: Windows native
    try {
      await execAsync('whisper --version', { timeout: 3000 })
      console.log('   ✅ Found Whisper (Windows)')
      return true
    } catch {}

    // Try 2: WSL Ubuntu
    try {
      await execAsync('wsl whisper --version', { timeout: 3000 })
      console.log('   ✅ Found Whisper (WSL Ubuntu)')
      return true
    } catch {}

    // Try 3: WSL with full path
    try {
      await execAsync('wsl ~/.local/bin/whisper --version', { timeout: 3000 })
      console.log('   ✅ Found Whisper (WSL full path)')
      return true
    } catch {}

    return false
  }

  /**
   * Extract embedded subtitles
   */
  private async extractEmbeddedSubtitles(videoPath: string, outputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .outputOptions(['-map 0:s:0', '-c:s srt'])
        .output(outputPath)
        .on('end', () => resolve(true))
        .on('error', () => resolve(false))
        .run()
    })
  }

  /**
   * Generate with Whisper (WSL-aware)
   */
  private async generateWithWhisper(videoPath: string, outputPath: string): Promise<void> {
    const tempAudioPath = outputPath.replace('.srt', '_temp.wav')
    
    try {
      // Extract audio
      console.log('🎵 Extracting audio for Whisper...')
      await this.extractAudioForWhisper(videoPath, tempAudioPath)

      const outputDir = path.dirname(outputPath)
      const baseName = path.basename(tempAudioPath, '.wav')

      console.log('🤖 Running Whisper transcription...')

      // Convert Windows path to WSL path if needed
      const wslAudioPath = await this.convertToWSLPath(tempAudioPath)
      const wslOutputDir = await this.convertToWSLPath(outputDir)

      // Build command - try WSL first, then Windows
      let command = ''
      let useWSL = false

      // Try WSL first
      try {
        await execAsync('wsl whisper --version', { timeout: 2000 })
        useWSL = true
        command = `wsl whisper "${wslAudioPath}" --model small --output_dir "${wslOutputDir}" --output_format srt`
      } catch {
        // Fallback to Windows
        command = `whisper "${tempAudioPath}" --model small --output_dir "${outputDir}" --output_format srt`
      }

      console.log(`   Using: ${useWSL ? 'WSL Ubuntu' : 'Windows'} Whisper`)

      // Run Whisper
      const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024, timeout: 600000 })

      console.log('✅ Whisper transcription complete!')

      // Find generated file
      const whisperOutput = path.join(outputDir, `${baseName}.srt`)
      
      if (whisperOutput !== outputPath) {
        await fs.rename(whisperOutput, outputPath).catch(() => {})
      }

      // Cleanup
      await fs.unlink(tempAudioPath).catch(() => {})

    } catch (error: any) {
      console.error('❌ Whisper failed:', error.message)
      await fs.unlink(tempAudioPath).catch(() => {})
      
      console.log('⚠️  Falling back to placeholder subtitles')
      await this.createPlaceholderSubtitles(outputPath)
    }
  }

  /**
   * Convert Windows path to WSL path
   */
  private async convertToWSLPath(windowsPath: string): Promise<string> {
    try {
      // C:\Users\... -> /mnt/c/Users/...
      const { stdout } = await execAsync(`wsl wslpath -u "${windowsPath}"`)
      return stdout.trim()
    } catch {
      return windowsPath
    }
  }

  /**
   * Extract audio for Whisper (16kHz mono WAV)
   */
  private async extractAudioForWhisper(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  /**
   * Create placeholder
   */
  private async createPlaceholderSubtitles(outputPath: string): Promise<void> {
    const placeholder = `1
00:00:00,000 --> 00:00:05,000
[Auto-generated caption placeholder - segment 1]

2
00:00:05,000 --> 00:00:10,000
[Auto-generated caption placeholder - segment 2]

3
00:00:10,000 --> 00:00:15,000
[Auto-generated caption placeholder - segment 3]
`
    await fs.writeFile(outputPath, placeholder, 'utf-8')
  }
}