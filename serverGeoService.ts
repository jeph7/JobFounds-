import { clampStr } from './serverSecurity.ts';

export interface GeocodedPlace {
  id: string;
  displayName: string;
  city: string;
  state?: string;
  country: string;
  countryCode?: string;
  lat: number;
  lon: number;
  osmUrl: string;
  category?: string;
  source: 'nominatim' | 'cache' | 'fallback';
}

export interface GeoSearchResponse {
  places: GeocodedPlace[];
  source: 'nominatim' | 'cache' | 'fallback';
  fallbackUsed: boolean;
  notice?: string;
}

export interface GeoReverseResponse {
  place: GeocodedPlace | null;
  source: 'nominatim' | 'cache' | 'fallback';
  fallbackUsed: boolean;
  notice?: string;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_USER_AGENT =
  'JOBFOUNDS/1.0 (https://jobfounds.com; contact@jobfounds.com)';
const MIN_NOMINATIM_INTERVAL_MS = 1150; // Strict <= 1 req/sec compliance per OSM Nominatim Usage Policy
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days
const MAX_CACHE_ENTRIES = 1500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const searchCache = new Map<string, CacheEntry<GeocodedPlace[]>>();
const reverseCache = new Map<string, CacheEntry<GeocodedPlace>>();

// Serialized global queue so outbound Nominatim requests strictly respect 1 req/sec
let lastNominatimRequestAt = 0;
let nominatimQueue: Promise<unknown> = Promise.resolve();

function scheduleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const task = nominatimQueue.then(async () => {
    const elapsed = Date.now() - lastNominatimRequestAt;
    if (elapsed < MIN_NOMINATIM_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_NOMINATIM_INTERVAL_MS - elapsed));
    }
    lastNominatimRequestAt = Date.now();
    return fn();
  });
  nominatimQueue = task.catch(() => {});
  return task;
}

function setBoundedCache<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (map.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey) map.delete(oldestKey);
  }
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOsmUrl(lat: number, lon: number, zoom = 12): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=${zoom}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

// Resilient built-in global hubs & countries fallback index (real WGS84 centroids)
// Used for zero-latency batch pin resolution and graceful fallback if Nominatim is temporarily unavailable.
interface FallbackHub {
  city: string;
  country: string;
  countryCode: string;
  aliases: string[];
  lat: number;
  lon: number;
}

const FALLBACK_HUBS: FallbackHub[] = [
  { city: 'Paris', country: 'France', countryCode: 'FR', aliases: ['france', 'ile-de-france', 'la defense'], lat: 48.8566, lon: 2.3522 },
  { city: 'Lyon', country: 'France', countryCode: 'FR', aliases: ['rhone'], lat: 45.764, lon: 4.8357 },
  { city: 'Marseille', country: 'France', countryCode: 'FR', aliases: ['provence'], lat: 43.2965, lon: 5.3698 },
  { city: 'Toulouse', country: 'France', countryCode: 'FR', aliases: [], lat: 43.6047, lon: 1.4442 },
  { city: 'Bordeaux', country: 'France', countryCode: 'FR', aliases: [], lat: 44.8378, lon: -0.5792 },
  { city: 'Nantes', country: 'France', countryCode: 'FR', aliases: [], lat: 47.2184, lon: -1.5536 },
  { city: 'Lille', country: 'France', countryCode: 'FR', aliases: [], lat: 50.6292, lon: 3.0573 },
  { city: 'Zurich', country: 'Switzerland', countryCode: 'CH', aliases: ['suisse', 'schweiz', 'switzerland', 'zuerich'], lat: 47.3769, lon: 8.5417 },
  { city: 'Geneva', country: 'Switzerland', countryCode: 'CH', aliases: ['geneve', 'genf'], lat: 46.2044, lon: 6.1432 },
  { city: 'Lausanne', country: 'Switzerland', countryCode: 'CH', aliases: [], lat: 46.5197, lon: 6.6323 },
  { city: 'Basel', country: 'Switzerland', countryCode: 'CH', aliases: ['bale'], lat: 47.5596, lon: 7.5886 },
  { city: 'Montreal', country: 'Canada', countryCode: 'CA', aliases: ['montreal', 'quebec', 'canada'], lat: 45.5017, lon: -73.5673 },
  { city: 'Toronto', country: 'Canada', countryCode: 'CA', aliases: ['ontario'], lat: 43.6532, lon: -79.3832 },
  { city: 'Vancouver', country: 'Canada', countryCode: 'CA', aliases: ['british columbia'], lat: 49.2827, lon: -123.1207 },
  { city: 'Ottawa', country: 'Canada', countryCode: 'CA', aliases: [], lat: 45.4215, lon: -75.6972 },
  { city: 'Quebec City', country: 'Canada', countryCode: 'CA', aliases: ['ville de quebec'], lat: 46.8139, lon: -71.208 },
  { city: 'London', country: 'United Kingdom', countryCode: 'GB', aliases: ['londres', 'uk', 'royaume-uni', 'england', 'united kingdom'], lat: 51.5074, lon: -0.1278 },
  { city: 'Manchester', country: 'United Kingdom', countryCode: 'GB', aliases: [], lat: 53.4808, lon: -2.2426 },
  { city: 'Edinburgh', country: 'United Kingdom', countryCode: 'GB', aliases: ['edimbourg', 'scotland'], lat: 55.9533, lon: -3.1883 },
  { city: 'Berlin', country: 'Germany', countryCode: 'DE', aliases: ['allemagne', 'deutschland', 'germany'], lat: 52.52, lon: 13.405 },
  { city: 'Munich', country: 'Germany', countryCode: 'DE', aliases: ['munchen', 'muenchen', 'bavaria'], lat: 48.1351, lon: 11.582 },
  { city: 'Frankfurt', country: 'Germany', countryCode: 'DE', aliases: ['francfort'], lat: 50.1109, lon: 8.6821 },
  { city: 'Hamburg', country: 'Germany', countryCode: 'DE', aliases: ['hambourg'], lat: 53.5511, lon: 9.9937 },
  { city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', aliases: ['pays-bas', 'netherlands', 'holland'], lat: 52.3676, lon: 4.9041 },
  { city: 'Rotterdam', country: 'Netherlands', countryCode: 'NL', aliases: [], lat: 51.9244, lon: 4.4777 },
  { city: 'Brussels', country: 'Belgium', countryCode: 'BE', aliases: ['bruxelles', 'belgique', 'belgium', 'brussel'], lat: 50.8503, lon: 4.3517 },
  { city: 'Luxembourg', country: 'Luxembourg', countryCode: 'LU', aliases: ['luxembourg city'], lat: 49.6116, lon: 6.1319 },
  { city: 'Dublin', country: 'Ireland', countryCode: 'IE', aliases: ['irlande', 'ireland'], lat: 53.3498, lon: -6.2603 },
  { city: 'Madrid', country: 'Spain', countryCode: 'ES', aliases: ['espagne', 'espana', 'spain'], lat: 40.4168, lon: -3.7038 },
  { city: 'Barcelona', country: 'Spain', countryCode: 'ES', aliases: ['barcelone'], lat: 41.3874, lon: 2.1686 },
  { city: 'Lisbon', country: 'Portugal', countryCode: 'PT', aliases: ['lisbonne', 'lisboa', 'portugal'], lat: 38.7223, lon: -9.1393 },
  { city: 'Porto', country: 'Portugal', countryCode: 'PT', aliases: [], lat: 41.1579, lon: -8.6291 },
  { city: 'Milan', country: 'Italy', countryCode: 'IT', aliases: ['milano', 'italie', 'italy'], lat: 45.4642, lon: 9.19 },
  { city: 'Rome', country: 'Italy', countryCode: 'IT', aliases: ['roma'], lat: 41.9028, lon: 12.4964 },
  { city: 'Stockholm', country: 'Sweden', countryCode: 'SE', aliases: ['suede', 'sweden'], lat: 59.3293, lon: 18.0686 },
  { city: 'Copenhagen', country: 'Denmark', countryCode: 'DK', aliases: ['copenhague', 'danemark', 'denmark'], lat: 55.6761, lon: 12.5683 },
  { city: 'Oslo', country: 'Norway', countryCode: 'NO', aliases: ['norvege', 'norway'], lat: 59.9139, lon: 10.7522 },
  { city: 'Helsinki', country: 'Finland', countryCode: 'FI', aliases: ['finlande', 'finland'], lat: 60.1699, lon: 24.9384 },
  { city: 'Vienna', country: 'Austria', countryCode: 'AT', aliases: ['vienne', 'wien', 'autriche', 'austria'], lat: 48.2082, lon: 16.3738 },
  { city: 'Warsaw', country: 'Poland', countryCode: 'PL', aliases: ['varsovie', 'pologne', 'poland'], lat: 52.2297, lon: 21.0122 },
  { city: 'Prague', country: 'Czech Republic', countryCode: 'CZ', aliases: ['praha', 'czechia'], lat: 50.0755, lon: 14.4378 },
  { city: 'New York', country: 'United States', countryCode: 'US', aliases: ['nyc', 'usa', 'us', 'etats-unis', 'united states'], lat: 40.7128, lon: -74.006 },
  { city: 'San Francisco', country: 'United States', countryCode: 'US', aliases: ['bay area', 'silicon valley', 'california'], lat: 37.7749, lon: -122.4194 },
  { city: 'Boston', country: 'United States', countryCode: 'US', aliases: [], lat: 42.3601, lon: -71.0589 },
  { city: 'Seattle', country: 'United States', countryCode: 'US', aliases: [], lat: 47.6062, lon: -122.3321 },
  { city: 'Austin', country: 'United States', countryCode: 'US', aliases: ['texas'], lat: 30.2672, lon: -97.7431 },
  { city: 'Miami', country: 'United States', countryCode: 'US', aliases: ['florida'], lat: 25.7617, lon: -80.1918 },
  { city: 'Chicago', country: 'United States', countryCode: 'US', aliases: [], lat: 41.8781, lon: -87.6298 },
  { city: 'Los Angeles', country: 'United States', countryCode: 'US', aliases: [], lat: 34.0522, lon: -118.2437 },
  { city: 'Washington', country: 'United States', countryCode: 'US', aliases: ['washington dc'], lat: 38.9072, lon: -77.0369 },
  { city: 'Singapore', country: 'Singapore', countryCode: 'SG', aliases: ['singapour'], lat: 1.3521, lon: 103.8198 },
  { city: 'Tokyo', country: 'Japan', countryCode: 'JP', aliases: ['japon', 'japan'], lat: 35.6762, lon: 139.6503 },
  { city: 'Seoul', country: 'South Korea', countryCode: 'KR', aliases: ['coree du sud', 'south korea'], lat: 37.5665, lon: 126.978 },
  { city: 'Sydney', country: 'Australia', countryCode: 'AU', aliases: ['australie', 'australia'], lat: -33.8688, lon: 151.2093 },
  { city: 'Melbourne', country: 'Australia', countryCode: 'AU', aliases: [], lat: -37.8136, lon: 144.9631 },
  { city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', aliases: ['dubai', 'uae', 'emirats arabes unis'], lat: 25.2048, lon: 55.2708 },
  { city: 'Riyadh', country: 'Saudi Arabia', countryCode: 'SA', aliases: ['riyad', 'arabie saoudite', 'saudi arabia'], lat: 24.7136, lon: 46.6753 },
  { city: 'Doha', country: 'Qatar', countryCode: 'QA', aliases: ['qatar'], lat: 25.2854, lon: 51.531 },
  { city: 'Casablanca', country: 'Morocco', countryCode: 'MA', aliases: ['maroc', 'morocco'], lat: 33.5731, lon: -7.5898 },
  { city: 'Rabat', country: 'Morocco', countryCode: 'MA', aliases: [], lat: 34.0209, lon: -6.8416 },
  { city: 'Tunis', country: 'Tunisia', countryCode: 'TN', aliases: ['tunisie', 'tunisia'], lat: 36.8065, lon: 10.1815 },
  { city: 'Dakar', country: 'Senegal', countryCode: 'SN', aliases: ['senegal'], lat: 14.7167, lon: -17.4677 },
  { city: 'Abidjan', country: 'Ivory Coast', countryCode: 'CI', aliases: ['cote d ivoire', 'cote divoire'], lat: 5.36, lon: -4.0083 },
  { city: 'Nairobi', country: 'Kenya', countryCode: 'KE', aliases: ['kenya'], lat: -1.2921, lon: 36.8219 },
  { city: 'Kigali', country: 'Rwanda', countryCode: 'RW', aliases: ['rwanda'], lat: -1.9441, lon: 30.0619 },
  { city: 'Lagos', country: 'Nigeria', countryCode: 'NG', aliases: ['nigeria'], lat: 6.5244, lon: 3.3792 },
  { city: 'Cape Town', country: 'South Africa', countryCode: 'ZA', aliases: ['le cap', 'afrique du sud', 'south africa'], lat: -33.9249, lon: 18.4241 },
  { city: 'Port-au-Prince', country: 'Haiti', countryCode: 'HT', aliases: ['haiti', 'ayiti'], lat: 18.5944, lon: -72.3074 },
  { city: 'Cap-Haitien', country: 'Haiti', countryCode: 'HT', aliases: ['okap'], lat: 19.7592, lon: -72.1982 },
  { city: 'Santo Domingo', country: 'Dominican Republic', countryCode: 'DO', aliases: ['republique dominicaine'], lat: 18.4861, lon: -69.9312 },
  { city: 'Mexico City', country: 'Mexico', countryCode: 'MX', aliases: ['mexico', 'mexique', 'cdmx'], lat: 19.4326, lon: -99.1332 },
  { city: 'Sao Paulo', country: 'Brazil', countryCode: 'BR', aliases: ['bresil', 'brazil'], lat: -23.5505, lon: -46.6333 },
  { city: 'Bogota', country: 'Colombia', countryCode: 'CO', aliases: ['colombie', 'colombia'], lat: 4.711, lon: -74.0721 },
  { city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', aliases: ['argentine', 'argentina'], lat: -34.6037, lon: -58.3816 },
  { city: 'Bengaluru', country: 'India', countryCode: 'IN', aliases: ['bangalore', 'inde', 'india'], lat: 12.9716, lon: 77.5946 },
  { city: 'Mumbai', country: 'India', countryCode: 'IN', aliases: [], lat: 19.076, lon: 72.8777 },
];

function matchFallbackHubs(rawQuery: string, limit = 6): GeocodedPlace[] {
  const norm = normalizeText(rawQuery);
  if (!norm) return [];
  const tokens = norm.split(' ').filter((t) => t.length >= 2);
  const scored: Array<{ hub: FallbackHub; score: number }> = [];

  for (const hub of FALLBACK_HUBS) {
    const cityNorm = normalizeText(hub.city);
    const countryNorm = normalizeText(hub.country);
    const aliasNorms = hub.aliases.map(normalizeText);
    const haystack = [cityNorm, countryNorm, ...aliasNorms].join(' ');

    let score = 0;
    if (norm === cityNorm || norm === `${cityNorm} ${countryNorm}`) score += 100;
    else if (norm.includes(cityNorm) && cityNorm.length >= 3) score += 70;
    else if (cityNorm.includes(norm) && norm.length >= 3) score += 55;

    if (norm === countryNorm || aliasNorms.includes(norm)) score += 60;
    else if (norm.includes(countryNorm) && countryNorm.length >= 3) score += 35;

    for (const token of tokens) {
      if (haystack.includes(token)) score += 12;
    }

    if (score >= 30) {
      scored.push({ hub, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ hub }) => ({
    id: `fallback-${normalizeText(hub.city)}-${hub.countryCode.toLowerCase()}`,
    displayName: `${hub.city}, ${hub.country}`,
    city: hub.city,
    country: hub.country,
    countryCode: hub.countryCode,
    lat: hub.lat,
    lon: hub.lon,
    osmUrl: buildOsmUrl(hub.lat, hub.lon, 11),
    category: 'city',
    source: 'fallback',
  }));
}

function findNearestFallbackHub(lat: number, lon: number): GeocodedPlace | null {
  let best: FallbackHub | null = null;
  let bestDist = Infinity;
  for (const hub of FALLBACK_HUBS) {
    const dLat = hub.lat - lat;
    const dLon = hub.lon - lon;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) {
      bestDist = dist;
      best = hub;
    }
  }
  if (!best) return null;
  return {
    id: `fallback-${normalizeText(best.city)}-${best.countryCode.toLowerCase()}`,
    displayName: `${best.city}, ${best.country}`,
    city: best.city,
    country: best.country,
    countryCode: best.countryCode,
    lat,
    lon,
    osmUrl: buildOsmUrl(lat, lon, 12),
    category: 'city',
    source: 'fallback',
  };
}

function mapNominatimItem(item: any, source: 'nominatim' | 'cache' = 'nominatim'): GeocodedPlace | null {
  const lat = Number(item?.lat);
  const lon = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const addr = item?.address || {};
  const city =
    String(
      addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.county ||
        addr.state ||
        item?.name ||
        ''
    ).trim();
  const country = String(addr.country || '').trim();
  const state = typeof addr.state === 'string' ? addr.state.trim() : undefined;
  const countryCode =
    typeof addr.country_code === 'string' ? addr.country_code.toUpperCase() : undefined;

  return {
    id: `osm-${item?.osm_type || 'p'}-${item?.osm_id || `${lat.toFixed(4)}_${lon.toFixed(4)}`}`,
    displayName: String(item?.display_name || [city, country].filter(Boolean).join(', ')),
    city: city || country || 'Location',
    state,
    country: country || city || 'International',
    countryCode,
    lat,
    lon,
    osmUrl: buildOsmUrl(lat, lon, 12),
    category: typeof item?.type === 'string' ? item.type : typeof item?.class === 'string' ? item.class : undefined,
    source,
  };
}

export async function searchNominatimPlaces(params: {
  q?: string;
  city?: string;
  country?: string;
  lang?: string;
  limit?: number;
}): Promise<GeoSearchResponse> {
  const safeQ = clampStr(params.q, 180);
  const safeCity = clampStr(params.city, 100);
  const safeCountry = clampStr(params.country, 100);
  const lang = clampStr(params.lang, 10) || 'fr';
  const limit = Math.max(1, Math.min(8, Number(params.limit) || 6));

  const combined = [safeQ, safeCity, safeCountry].filter(Boolean).join(', ').trim();
  if (!combined) {
    return { places: [], source: 'cache', fallbackUsed: false };
  }

  const cacheKey = `${lang}|${normalizeText(combined)}|${limit}`;
  const cached = getCached(searchCache, cacheKey);
  if (cached) {
    return {
      places: cached.map((p) => ({ ...p, source: 'cache' })),
      source: 'cache',
      fallbackUsed: false,
    };
  }

  try {
    const places = await scheduleNominatim(async () => {
      const qs = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: String(limit),
        'accept-language': lang,
      });

      if (safeQ) {
        qs.set('q', combined);
      } else {
        if (safeCity) qs.set('city', safeCity);
        if (safeCountry) qs.set('country', safeCountry);
        if (!safeCity && !safeCountry) qs.set('q', combined);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7500);
      try {
        const res = await fetch(`${NOMINATIM_BASE}/search?${qs.toString()}`, {
          headers: {
            'User-Agent': NOMINATIM_USER_AGENT,
            Accept: 'application/json',
            Referer: process.env.APP_URL || 'https://jobfounds.com/',
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Nominatim HTTP ${res.status}`);
        }
        const json = (await res.json()) as unknown[];
        if (!Array.isArray(json)) return [];
        const mapped = json
          .map((item) => mapNominatimItem(item, 'nominatim'))
          .filter((item): item is GeocodedPlace => item !== null);
        return mapped;
      } finally {
        clearTimeout(timeout);
      }
    });

    if (places.length > 0) {
      setBoundedCache(searchCache, cacheKey, places);
      return {
        places,
        source: 'nominatim',
        fallbackUsed: false,
      };
    }

    // If structured search returned empty, check fallback hub index before returning empty
    const fallback = matchFallbackHubs(combined, limit);
    if (fallback.length > 0) {
      return {
        places: fallback,
        source: 'fallback',
        fallbackUsed: true,
        notice:
          lang === 'fr'
            ? 'Résultat issu de l’index géographique de secours JOBFOUNDS.'
            : 'Result loaded from JOBFOUNDS geographic fallback index.',
      };
    }

    return { places: [], source: 'nominatim', fallbackUsed: false };
  } catch (err) {
    console.warn('Nominatim search temporarily unavailable, using fallback index:', err);
    const fallback = matchFallbackHubs(combined, limit);
    return {
      places: fallback,
      source: 'fallback',
      fallbackUsed: true,
      notice:
        lang === 'fr'
          ? 'Le service de géocodage Nominatim est temporairement ralenti ou indisponible. Mode de repli géographique activé.'
          : 'Nominatim geocoding is temporarily unavailable or rate-limited. Geographic fallback mode enabled.',
    };
  }
}

export async function reverseNominatimPlace(params: {
  lat: number;
  lon: number;
  lang?: string;
}): Promise<GeoReverseResponse> {
  const { lat, lon } = params;
  const lang = clampStr(params.lang, 10) || 'fr';
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { place: null, source: 'fallback', fallbackUsed: true };
  }

  const cacheKey = `${lang}|${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = getCached(reverseCache, cacheKey);
  if (cached) {
    return {
      place: { ...cached, source: 'cache' },
      source: 'cache',
      fallbackUsed: false,
    };
  }

  try {
    const place = await scheduleNominatim(async () => {
      const qs = new URLSearchParams({
        format: 'jsonv2',
        lat: lat.toFixed(6),
        lon: lon.toFixed(6),
        addressdetails: '1',
        zoom: '10',
        'accept-language': lang,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7500);
      try {
        const res = await fetch(`${NOMINATIM_BASE}/reverse?${qs.toString()}`, {
          headers: {
            'User-Agent': NOMINATIM_USER_AGENT,
            Accept: 'application/json',
            Referer: process.env.APP_URL || 'https://jobfounds.com/',
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Nominatim reverse HTTP ${res.status}`);
        }
        const json = await res.json();
        return mapNominatimItem(json, 'nominatim');
      } finally {
        clearTimeout(timeout);
      }
    });

    if (place) {
      setBoundedCache(reverseCache, cacheKey, place);
      return { place, source: 'nominatim', fallbackUsed: false };
    }
  } catch (err) {
    console.warn('Nominatim reverse temporarily unavailable, using nearest hub fallback:', err);
  }

  const nearest = findNearestFallbackHub(lat, lon);
  return {
    place: nearest,
    source: 'fallback',
    fallbackUsed: true,
    notice:
      lang === 'fr'
        ? 'Géolocalisation inversée Nominatim temporairement indisponible : pôle le plus proche utilisé.'
        : 'Nominatim reverse geocoding temporarily unavailable; nearest major hub used.',
  };
}

/**
 * Resolves a bounded list of city/country labels for job & company map pins
 * WITHOUT violating Nominatim's bulk-geocoding ban:
 * - First resolves from cache and the curated global hub index (instant, 0 external calls).
 * - Performs at most 1 live Nominatim lookup per batch for any uncached single location.
 */
export async function resolveLocationsBatch(
  labels: string[],
  lang = 'fr'
): Promise<Record<string, GeocodedPlace>> {
  const uniqueLabels = Array.from(
    new Set(
      labels
        .map((l) => clampStr(l, 120))
        .filter((l) => l.length >= 2 && !/^remote$|^worldwide$|^global$|^international$/i.test(l))
    )
  ).slice(0, 15);

  const resolved: Record<string, GeocodedPlace> = {};
  let liveLookupsRemaining = 1;

  for (const label of uniqueLabels) {
    const primarySegment = label.split(/[·/|]/)[0]?.trim() || label;
    const cacheKey = `${lang}|${normalizeText(primarySegment)}|1`;
    const cached = getCached(searchCache, cacheKey);
    if (cached && cached[0]) {
      resolved[label] = { ...cached[0], source: 'cache' };
      continue;
    }

    const fallbackMatches = matchFallbackHubs(primarySegment, 1);
    if (fallbackMatches[0]) {
      resolved[label] = fallbackMatches[0];
      continue;
    }

    if (liveLookupsRemaining > 0) {
      liveLookupsRemaining -= 1;
      const live = await searchNominatimPlaces({ q: primarySegment, lang, limit: 1 });
      if (live.places[0]) {
        resolved[label] = live.places[0];
      }
    }
  }

  return resolved;
}
