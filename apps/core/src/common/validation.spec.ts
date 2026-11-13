import { BadRequestException, type ValidationError } from '@nestjs/common';
import { PaginationQueryDto } from './pagination-query.dto';
import { createValidationPipe, validationDetails } from './validation';

describe('validationDetails', () => {
  it('flattens children into dotted field paths', () => {
    const errors = [
      {
        property: 'address',
        children: [
          {
            property: 'street',
            children: [
              {
                property: 'number',
                constraints: { isInt: 'number must be an integer' },
                children: [],
              },
            ],
            constraints: {},
          },
          {
            property: 'city',
            constraints: { isString: 'city must be a string' },
            children: [],
          },
        ],
        constraints: {},
      },
    ] as unknown as ValidationError[];

    expect(validationDetails(errors)).toEqual([
      { field: 'address.street.number', message: 'number must be an integer' },
      { field: 'address.city', message: 'city must be a string' },
    ]);
  });

  it('keeps every constraint message on one field', () => {
    const errors = [
      {
        property: 'password',
        constraints: {
          minLength: 'password must be longer than 8 characters',
          matches: 'password must contain a digit',
        },
        children: [],
      },
    ] as unknown as ValidationError[];

    expect(validationDetails(errors)).toEqual([
      { field: 'password', message: 'password must be longer than 8 characters' },
      { field: 'password', message: 'password must contain a digit' },
    ]);
  });
});

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (err) {
    return err;
  }
}

interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details: { field?: string; message: string }[];
}

function responseOf(err: unknown): ErrorResponse {
  expect(err).toBeInstanceOf(BadRequestException);
  return (err as BadRequestException).getResponse() as ErrorResponse;
}

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();
  const meta = { type: 'query' as const, metatype: PaginationQueryDto };

  it('keeps the transform options (string query param becomes a number)', async () => {
    await expect(pipe.transform({ limit: '5' }, meta)).resolves.toEqual({ limit: 5, offset: 0 });
  });

  it('answers VALIDATION_FAILED with a field detail and a joined message', async () => {
    const err = await caught(pipe.transform({ limit: 0 }, meta));
    const body = responseOf(err);

    expect(body.statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toContain('limit must not be less than 1');
    expect(body.details.map((detail) => detail.field)).toEqual(['limit']);
    expect(body.details[0]?.message).toContain('limit must not be less than 1');
  });

  it('reports a forbidden extra key as a detail with its field path', async () => {
    const err = await caught(pipe.transform({ limit: 5, notAField: 1 }, meta));
    const body = responseOf(err);

    expect(body.statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details.map((detail) => detail.field)).toEqual(['notAField']);
    expect(body.details[0]?.message).toContain('notAField');
  });
});
