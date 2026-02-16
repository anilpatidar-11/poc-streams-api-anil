// database/migrations/xxx_add_upload_duration_to_videos.ts

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videos'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Upload duration in milliseconds
      table.integer('upload_duration').nullable()

      // Indexes for performance
      table.index(['upload_time'], 'idx_videos_upload_time')
      table.index(['status'], 'idx_videos_status')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('upload_duration')

      // Drop indexes
      table.dropIndex(['upload_time'], 'idx_videos_upload_time')
      table.dropIndex(['status'], 'idx_videos_status')
    })
  }
}
