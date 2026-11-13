import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import * as models from './response-models';

// Smoke test for the response-model components: every decorated class is explored (a bad
// decorator option, a circular $ref or a duplicate schema name throws here, not on `/docs`).
describe('response models', () => {
  it('explores every model into the OpenAPI components', async () => {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
      extraModels: Object.values(models),
    });
    const schemas = document.components?.schemas ?? {};
    expect(Object.keys(schemas)).toContain('AssetModel');
    expect(Object.keys(schemas)).toContain('UploadCompleteResponseModel');
    expect(Object.keys(schemas)).toContain('MergeBackupResultModel');
    // union rows depend on the isArray+oneOf combination surviving schema exploration
    expect(JSON.stringify(schemas.ShareListResponseModel)).toContain('oneOf');
    await app.close();
  });
});
