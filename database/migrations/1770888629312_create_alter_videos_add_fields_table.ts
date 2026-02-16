import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videos'

  /**
   * ══════════════════════════════════════════════════════════════
   * ALTER VIDEOS TABLE - ADD NEW FIELDS
   * ══════════════════════════════════════════════════════════════
   * 
   * New fields:
   * - upload_time (timestamp) → when video was uploaded
   * - extension (string) → .mp4, .avi, .mov etc
   * - subtitle_path (string) → path to .srt subtitle file
   * 
   * Run: node ace migration:run
   */
  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Upload timestamp (when user uploaded the video)
      table.timestamp('upload_time').nullable()

      // Video file extension (.mp4, .avi, .mov, .mkv)
      table.string('extension', 10).nullable()

      // Subtitle/caption file path (.srt format)
      table.string('subtitle_path').nullable()

      // Processing started timestamp
      table.timestamp('processing_started_at').nullable()

      // Processing completed timestamp
      table.timestamp('processing_completed_at').nullable()
    })
  }

  /**
   * Rollback - remove new columns
   */
  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('upload_time')
      table.dropColumn('extension')
      table.dropColumn('subtitle_path')
      table.dropColumn('processing_started_at')
      table.dropColumn('processing_completed_at')
    })
  }
}