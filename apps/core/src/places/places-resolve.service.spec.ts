import type { Repository } from 'typeorm';
import type { Place } from '../database/entities/place.entity';
import { PlacesResolveService } from './places-resolve.service';

const paris = {
  name: 'Paris',
  admin1Code: '11' as string | null,
  countryCode: 'FR',
  timezone: 'Europe/Paris' as string | null,
};

function serviceFor(rows: unknown[]): PlacesResolveService {
  const repo = { query: vi.fn(() => Promise.resolve(rows)) };
  return new PlacesResolveService(repo as unknown as Repository<Place>);
}

function resolveWith(distanceKm: number | null, row = paris): Promise<unknown> {
  return serviceFor([{ ...row, distanceKm }]).resolve(48.85, 2.35);
}

describe('PlacesResolveService.resolve', () => {
  it('maps the nearest city to place fields', async () => {
    await expect(resolveWith(0.4)).resolves.toEqual({
      placeCity: 'Paris',
      placeAdmin1: '11',
      placeCountryCode: 'FR',
      placeTimezone: 'Europe/Paris',
      placeDistanceKm: 0.4,
    });
  });

  it('keeps null admin1/timezone', async () => {
    await expect(
      resolveWith(12.5, { ...paris, admin1Code: null, timezone: null }),
    ).resolves.toEqual({
      placeCity: 'Paris',
      placeAdmin1: null,
      placeCountryCode: 'FR',
      placeTimezone: null,
      placeDistanceKm: 12.5,
    });
  });

  it('accepts exactly 50km', async () => {
    await expect(resolveWith(50)).resolves.not.toBeNull();
  });

  it('returns null beyond 50km', async () => {
    await expect(resolveWith(50.1)).resolves.toBeNull();
    await expect(resolveWith(1427)).resolves.toBeNull();
  });

  it('returns null for a null or non-finite distance', async () => {
    await expect(resolveWith(null)).resolves.toBeNull();
    await expect(resolveWith(Number.NaN)).resolves.toBeNull();
    await expect(resolveWith(Number.POSITIVE_INFINITY)).resolves.toBeNull();
  });

  it('returns null when no city is found', async () => {
    await expect(serviceFor([]).resolve(48.85, 2.35)).resolves.toBeNull();
  });
});
