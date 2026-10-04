import { Entity, PrimaryColumn, Column } from 'typeorm'

// GeoNames cities500 subset (CC-BY-4.0, https://www.geonames.org/) — offline reverse geocoding.
// Populated by `pnpm --filter @photox/core places:import`; see scripts/import-geonames.ts.
@Entity('places')
export class Place {
  @PrimaryColumn('int')
  geonameId!: number

  @Column('text')
  name!: string

  @Column('text')
  asciiName!: string

  @Column({ type: 'numeric', precision: 9, scale: 6 })
  latitude!: number

  @Column({ type: 'numeric', precision: 9, scale: 6 })
  longitude!: number

  @Column('varchar', { length: 2 })
  countryCode!: string

  @Column('varchar', { length: 20, nullable: true })
  admin1Code!: string | null

  @Column('varchar', { length: 80, nullable: true })
  admin2Code!: string | null

  @Column('int', { default: 0 })
  population!: number

  @Column('varchar', { length: 64, nullable: true })
  timezone!: string | null
}
