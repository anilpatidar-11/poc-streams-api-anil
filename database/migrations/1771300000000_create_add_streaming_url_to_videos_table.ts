import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videos'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('cloudinary_streaming_url').nullable().after('cloudinary_url')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('cloudinary_streaming_url')
    })
  }
}
