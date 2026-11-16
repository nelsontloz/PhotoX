import { Test } from '@nestjs/testing';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type SchemaObject,
} from '@nestjs/swagger';
import { beforeAll, describe, expect, it } from 'vitest';
import * as models from './response-models';

/** Properties/required through `allOf`, which is how an extended model is emitted. */
function flatten(schema: SchemaObject | undefined): { properties: string[]; required: string[] } {
  const properties = new Set(Object.keys(schema?.properties ?? {}));
  const required = new Set(schema?.required ?? []);
  for (const part of schema?.allOf ?? []) {
    const inner = flatten(part as SchemaObject);
    inner.properties.forEach((p) => properties.add(p));
    inner.required.forEach((p) => required.add(p));
  }
  return { properties: [...properties], required: [...required] };
}

describe('response models', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication();
    // Smoke test for the response-model components: every decorated class is explored (a bad
    // decorator option, a circular $ref or a duplicate schema name throws here, not on `/docs`).
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
      extraModels: Object.values(models),
    });
    await app.close();
  });

  it('explores every model into the OpenAPI components', () => {
    const schemas = document.components?.schemas ?? {};
    expect(Object.keys(schemas)).toContain('AssetModel');
    expect(Object.keys(schemas)).toContain('UploadCompleteResponseModel');
    expect(Object.keys(schemas)).toContain('MergeBackupResultModel');
    // union rows depend on the isArray+oneOf combination surviving schema exploration
    expect(JSON.stringify(schemas.ShareListResponseModel)).toContain('oneOf');
  });

  it('models the backup overview page envelope', () => {
    const schemas = document.components?.schemas ?? {};
    const page = schemas.BackupOverviewListResponseModel as SchemaObject | undefined;
    expect(page).toBeDefined();
    expect((page?.properties?.items as SchemaObject).type).toBe('array');
    expect((page?.properties?.total as SchemaObject).type).toBe('number');
    expect(page?.required).toEqual(expect.arrayContaining(['items', 'total']));
  });

  it('documents AddAssetsResponseModel.added as rows actually inserted', () => {
    const schemas = document.components?.schemas ?? {};
    const added = (schemas.AddAssetsResponseModel as SchemaObject | undefined)?.properties
      ?.added as SchemaObject | undefined;
    expect(added?.type).toBe('number');
    expect(added?.description).toMatch(/inserted/i);
  });

  it('advertises the raw share token on create responses only', () => {
    const schemas = document.components?.schemas ?? {};
    for (const item of ['AssetShareItemModel', 'AlbumShareItemModel']) {
      const { properties, required } = flatten(schemas[item] as SchemaObject);
      expect(properties).not.toContain('token');
      expect(required).not.toContain('token');
    }
    for (const created of ['AssetShareModel', 'AlbumShareModel']) {
      const { properties, required } = flatten(schemas[created] as SchemaObject);
      expect(properties).toContain('token');
      expect(required).toContain('token');
    }
    // the list rows must reference the token-free variants
    const list = JSON.stringify(schemas.ShareListResponseModel);
    expect(list).toContain('AssetShareItemModel');
    expect(list).toContain('AlbumShareItemModel');
  });
});
