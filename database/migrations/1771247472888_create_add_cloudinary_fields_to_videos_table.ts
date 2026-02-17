import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videos'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('storage_path').nullable().alter()
      table.string('cloudinary_url').nullable()
      table.string('cloudinary_public_id').nullable()
      table.index(['cloudinary_public_id'], 'idx_videos_cloudinary_public_id')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('cloudinary_url')
      table.dropColumn('cloudinary_public_id')
      table.dropIndex(['cloudinary_public_id'], 'idx_videos_cloudinary_public_id')
    })
  }
}