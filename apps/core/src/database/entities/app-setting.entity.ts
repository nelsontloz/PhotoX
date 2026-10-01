import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm'

@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn('text')
  key!: string

  @Column('jsonb')
  value!: unknown

  @UpdateDateColumn()
  updatedAt!: Date
}
