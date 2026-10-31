import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Face } from '../database/entities';
import { Person } from '../database/entities';
import { Asset } from '../database/entities';
import { AssetThumbnail } from '../database/entities';
import { FileRecord } from '../database/entities';
import { StorageModule } from '../files/storage/storage.module';
import { FacesQueryController } from './faces-query.controller';
import { FacesService } from './faces.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Face, Person, Asset, AssetThumbnail, FileRecord]),
    StorageModule,
  ],
  controllers: [FacesQueryController],
  providers: [FacesService],
  exports: [FacesService],
})
export class FacesModule {}
