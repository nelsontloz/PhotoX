import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Face } from './entities/face.entity'
import { FaceResponseDto } from './dto/face.dto'
import type { DetectedFaceInput } from '@photox/shared-types'

@Injectable()
export class FacesService {
  constructor(
    @InjectRepository(Face)
    private readonly repo: Repository<Face>,
  ) {}

  async registerFaces(
    assetId: string,
    userId: string,
    faces: DetectedFaceInput[],
  ): Promise<{ count: number }> {
    const entities = faces.map((f) => {
      const face = new Face()
      face.assetId = assetId
      face.userId = userId
      face.box = f.box
      face.confidence = f.confidence
      face.embedding = f.embedding
      return face
    })
    await this.repo.save(entities)
    return { count: entities.length }
  }

  async getForAsset(assetId: string): Promise<FaceResponseDto[]> {
    const faces = await this.repo.find({ where: { assetId } })
    return faces.map(FaceResponseDto.fromEntity)
  }

  async listForUser(userId: string, includeEmbeddings: boolean) {
    const faces = await this.repo.find({ where: { userId } })
    return faces.map((f) => ({
      id: f.id,
      assetId: f.assetId,
      box: f.box,
      ...(includeEmbeddings ? { embedding: f.embedding } : {}),
    }))
  }

  async assignPerson(userId: string, faceId: string, personId: string | null): Promise<void> {
    const face = await this.repo.findOne({ where: { id: faceId, userId } })
    if (!face) throw new NotFoundException('Face not found')
    face.personId = personId
    await this.repo.save(face)
  }
}
