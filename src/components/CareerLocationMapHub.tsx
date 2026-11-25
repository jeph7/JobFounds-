import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowUpRight,
  Briefcase,
  Building2,
  Compass,
  Info,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
} from 'lucide-react';
import { L } from '../i18n';
import { GeocodedPlace, JobListing, Lang } from '../types';
import { resolveGeoBatch, reverseGeoPlace, searchGeoPlaces } from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';

export interface MapCompanyItem {
  id: string;
  name: string;
  location: string;
  country: string;
  sector?: string;
  activeJobs?: number;
  website?: string;
}

interface CareerLocationMapHubProps {
  lang: Lang;
  defaultCity?: string;
  defaultCountry?: string;
  defaultCompany?: string;
  jobs?: JobListing[];
  companies?: MapCompanyItem[];
  onSelectLocation?: (loc: { country: string; city: string; lat?: number; lon?: number }) => void;
  onSearchOpportunities?: (loc: { country: string; city: string }) => void;
  onSelectJob?: (jobId: string) => void;
  compact?: boolean;
}

const POPULAR_COUNTRIES = [
  'France',
  'Suisse',
  'Canada',
  'Belgique',
  'Luxembourg',
  'Allemagne',
  'Pays-Bas',
  'Royaume-Uni',
  'Irlande',
  'Espagne',
  'Portugal',
  'Suède',
  'États-Unis',
  'Haïti',
  'Maroc',
  'Sénégal',
  'Côte d’Ivoire',
  'Émirats arabes unis',
  'Singapour',
];

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createPinIcon(variant: 'primary' | 'job' | 'company', badgeText?: string): Leaflet.DivIcon {
  const bg =
    variant === 'primary' ? '#06132F' : variant === 'job' ? '#287BC7' : '#102B52';
  const border = variant === 'primary' ? '#A9D8F5' : '#FFFFFF';
  const label = badgeText ? escapeHtml(badgeText) : '';

  const html =
    variant === 'job' && label
      ? `<div style="display:flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 6px;border-radius:9999px;background:${bg};border:2.5px solid ${border};color:#FFFFFF;font-family:IBM Plex Mono,monospace;font-size:11px;font-weight:700;box-shadow:0 3px 10px rgba(6,19,47,0.35);">${label}</div>`
      : `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:${bg};border:2.5px solid ${border};box-shadow:0 3px 10px rgba(6,19,47,0.35);"><div style="width:8px;height:8px;border-radius:9999px;background:#FFFFFF;transform:rotate(45deg);"></div></div>`;

  return Leaflet.divIcon({
    className: 'jf-leaflet-marker',
    html,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -24],
  });
}

function buildLocationKey(city?: string, country?: string): string {
  const cleanCity = (city || '').split(/[·/|]/)[0]?.trim() || '';
  const cleanCountry = (country || '').split(/[·/|]/)[0]?.trim() || '';
  if (cleanCity && !/^remote$|^worldwide$|^anywhere$/i.test(cleanCity)) {
    return cleanCountry ? `${cleanCity}, ${cleanCountry}` : cleanCity;
  }
  if (cleanCountry && !/^remote$|^worldwide$|^international$/i.test(cleanCountry)) {
    return cleanCountry;
  }
  return '';
}

export function CareerLocationMapHub({
  lang,
  defaultCity = '',
  defaultCountry = '',
  defaultCompany = '',
  jobs = [],
  companies = [],
  onSelectLocation,
  onSearchOpportunities,
  onSelectJob,
  compact = false,
}: CareerLocationMapHubProps) {
  const [country, setCountry] = useState(defaultCountry);
  const [city, setCity] = useState(defaultCity);
  const [addressQuery, setAddressQuery] = useState(defaultCompany ? `${defaultCompany}` : '');

  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<GeocodedPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<GeocodedPlace | null>(null);
  const [batchCoords, setBatchCoords] = useState<Record<string, GeocodedPlace>>({});

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<Leaflet.Map | null>(null);
  const markerLayerRef = useRef<Leaflet.LayerGroup | null>(null);

  // Sync external default changes when user updates parent filters
  useEffect(() => {
    if (defaultCountry !== undefined && defaultCountry !== country && !selectedPlace) {
      setCountry(defaultCountry);
    }
  }, [defaultCountry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (defaultCity !== undefined && defaultCity !== city && !selectedPlace) {
      setCity(defaultCity);
    }
  }, [defaultCity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collect distinct city/country labels from live jobs & companies for map pins
  const entityLocationLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const job of jobs.slice(0, 40)) {
      const k = buildLocationKey(job.city, job.country);
      if (k) labels.add(k);
    }
    for (const comp of companies.slice(0, 25)) {
      const k = buildLocationKey(comp.location, comp.country);
      if (k) labels.add(k);
    }
    if (defaultCity || defaultCountry) {
      const k = buildLocationKey(defaultCity, defaultCountry);
      if (k) labels.add(k);
    }
    return Array.from(labels).slice(0, 15);
  }, [jobs, companies, defaultCity, defaultCountry]);

  const entityLabelsKey = entityLocationLabels.join('|');

  // Resolve job/company hub coordinates cleanly (cache + hub index + <=1 Nominatim lookup)
  useEffect(() => {
    if (!entityLabelsKey) return;
    let cancelled = false;
    const labels = entityLabelsKey.split('|').filter(Boolean);
    resolveGeoBatch(labels, lang)
      .then((res) => {
        if (!cancelled && res.resolved) {
          setBatchCoords((prev) => ({ ...prev, ...res.resolved }));
        }
      })
      .catch(() => {
        // non-blocking — user can still search explicitly
      });
    return () => {
      cancelled = true;
    };
  }, [entityLabelsKey, lang]);

  // Initialize Leaflet + OpenStreetMap map once
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    const map = Leaflet.map(container, {
      center: [46.8, 4.5],
      zoom: 4,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    Leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    const layerGroup = Leaflet.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    markerLayerRef.current = layerGroup;

    // Ensure crisp tile layout inside tabs/accordions
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 180);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
      mapInstanceRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  // Group jobs by resolved location key so markers show clean counts & interactive popups
  const groupedJobPins = useMemo(() => {
    const groups: Record<
      string,
      { coord: GeocodedPlace; jobs: JobListing[]; label: string }
    > = {};
    for (const job of jobs) {
      const key = buildLocationKey(job.city, job.country);
      if (!key) continue;
      const coord = batchCoords[key];
      if (!coord) continue;
      if (!groups[key]) {
        groups[key] = { coord, jobs: [], label: key };
      }
      groups[key].jobs.push(job);
    }
    return Object.values(groups);
  }, [jobs, batchCoords]);

  const resolvedCompanyPins = useMemo(() => {
    const items: Array<{ company: MapCompanyItem; coord: GeocodedPlace }> = [];
    for (const comp of companies) {
      const key = buildLocationKey(comp.location, comp.country);
      if (!key) continue;
      const coord = batchCoords[key];
      if (!coord) continue;
      items.push({ company: comp, coord });
    }
    return items;
  }, [companies, batchCoords]);

  // Render all active Leaflet markers (selected location + jobs + companies)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const boundsPoints: Array<[number, number]> = [];

    // 1. Job Opportunity Cluster Pins
    for (const group of groupedJobPins) {
      const { coord, jobs: cityJobs, label } = group;
      boundsPoints.push([coord.lat, coord.lon]);
      const marker = Leaflet.marker([coord.lat, coord.lon], {
        icon: createPinIcon('job', String(cityJobs.length)),
      });

      const topJobsHtml = cityJobs
        .slice(0, 4)
        .map(
          (j) =>
            `<li style="margin:4px 0;font-size:12px;">
              <strong style="color:#06132F;">${escapeHtml(j.title)}</strong><br/>
              <span style="color:#365075;">${escapeHtml(j.company)} · ${escapeHtml(j.workMode)}</span>
            </li>`
        )
        .join('');

      const moreCount = cityJobs.length > 4 ? cityJobs.length - 4 : 0;
      const moreHtml =
        moreCount > 0
          ? `<div style="font-size:11px;color:#287BC7;margin-top:4px;">+${moreCount} ${
              lang === 'fr' ? 'autres offres' : 'more jobs'
            }</div>`
          : '';

      marker.bindPopup(`
        <div style="min-width:210px;max-width:270px;font-family:Manrope,sans-serif;">
          <div style="font-size:12px;font-weight:700;color:#287BC7;margin-bottom:4px;">
            ${escapeHtml(label)} (${cityJobs.length})
          </div>
          <ul style="list-style:none;padding:0;margin:0;">${topJobsHtml}</ul>
          ${moreHtml}
        </div>
      `);

      marker.on('click', () => {
        if (onSelectJob && cityJobs[0]) {
          onSelectJob(cityJobs[0].id);
        }
      });

      marker.addTo(layer);
    }

    // 2. Monitored Company Pins
    for (const { company, coord } of resolvedCompanyPins) {
      // Slight deterministic offset if sharing exact centroid with a job cluster
      const offsetLat = coord.lat + 0.008;
      const offsetLon = coord.lon + 0.008;
      boundsPoints.push([offsetLat, offsetLon]);

      const marker = Leaflet.marker([offsetLat, offsetLon], {
        icon: createPinIcon('company'),
      });

      const jobsBadge =
        typeof company.activeJobs === 'number'
          ? `<div style="font-size:11px;color:#287BC7;font-weight:600;margin-top:3px;">${company.activeJobs} ${
              lang === 'fr' ? 'offres actives' : 'active jobs'
            }</div>`
          : '';

      marker.bindPopup(`
        <div style="min-width:190px;max-width:250px;font-family:Manrope,sans-serif;">
          <div style="font-size:13px;font-weight:700;color:#06132F;">${escapeHtml(company.name)}</div>
          <div style="font-size:11px;color:#365075;margin-top:2px;">${escapeHtml(
            company.location || company.country
          )}</div>
          ${
            company.sector
              ? `<div style="font-size:11px;color:#556E91;margin-top:2px;">${escapeHtml(
                  company.sector
                )}</div>`
              : ''
          }
          ${jobsBadge}
        </div>
      `);

      marker.addTo(layer);
    }

    // 3. Selected Place / Searched City or Company Pin
    if (selectedPlace) {
      boundsPoints.push([selectedPlace.lat, selectedPlace.lon]);
      const marker = Leaflet.marker([selectedPlace.lat, selectedPlace.lon], {
        icon: createPinIcon('primary'),
      });
      const safeOsm = safeExternalUrl(selectedPlace.osmUrl);
      const osmLink = safeOsm
        ? `<div style="margin-top:6px;"><a href="${escapeHtml(
            safeOsm
          )}" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#287BC7;text-decoration:underline;">${
            lang === 'fr' ? 'Voir sur OpenStreetMap ↗' : 'View on OpenStreetMap ↗'
          }</a></div>`
        : '';

      marker.bindPopup(`
        <div style="min-width:200px;max-width:260px;font-family:Manrope,sans-serif;">
          <div style="font-size:13px;font-weight:700;color:#06132F;">${escapeHtml(
            defaultCompany ? `${defaultCompany} — ${selectedPlace.city}` : selectedPlace.city
          )}</div>
          <div style="font-size:11px;color:#365075;margin-top:2px;">${escapeHtml(
            selectedPlace.displayName
          )}</div>
          ${osmLink}
        </div>
      `);
      marker.addTo(layer);
      marker.openPopup();
    }

    // Center camera smoothly
    if (selectedPlace) {
      map.setView([selectedPlace.lat, selectedPlace.lon], 11, { animate: true });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 10, { animate: true });
    } else if (boundsPoints.length > 1) {
      const bounds = Leaflet.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 11 });
    }
  }, [groupedJobPins, resolvedCompanyPins, selectedPlace, defaultCompany, lang, onSelectJob]);

  const handleChoosePlace = useCallback(
    (place: GeocodedPlace) => {
      setSelectedPlace(place);
      setCity(place.city);
      setCountry(place.country);
      onSelectLocation?.({
        country: place.country,
        city: place.city,
        lat: place.lat,
        lon: place.lon,
      });
    },
    [onSelectLocation]
  );

  const handleSearchLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeoError(null);
    setGeoNotice(null);

    const q = addressQuery.trim();
    const cty = city.trim();
    const ctry = country.trim();
    if (!q && !cty && !ctry) {
      setGeoError(
        L(
          lang,
          'Veuillez saisir au moins un pays, une ville ou une adresse.',
          'Please enter at least a country, city, or address.'
        )
      );
      return;
    }

    setSearching(true);
    try {
      const res = await searchGeoPlaces({
        q: q || undefined,
        city: cty || undefined,
        country: ctry || undefined,
        lang,
        limit: 6,
      });

      setSearchResults(res.places);
      if (res.notice) {
        setGeoNotice(res.notice);
      }
      if (res.places.length > 0) {
        handleChoosePlace(res.places[0]);
      } else {
        setGeoError(
          L(
            lang,
            'Aucun lieu trouvé sur OpenStreetMap pour cette recherche. Essayez un nom de ville ou de pays plus simple.',
            'No matching location found on OpenStreetMap. Try a simpler city or country name.'
          )
        );
      }
    } catch (err) {
      setGeoError(
        err instanceof Error
          ? err.message
          : L(
              lang,
              'Le service de géocodage est temporairement indisponible. Vous pouvez tout de même filtrer les offres par pays et ville.',
              'Geocoding is temporarily unavailable. You can still filter opportunities by country and city.'
            )
      );
    } finally {
      setSearching(false);
    }
  };

  const handleDetectMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError(
        L(
          lang,
          'La géolocalisation du navigateur n’est pas disponible sur cet appareil.',
          'Browser geolocation is not supported on this device.'
        )
      );
      return;
    }

    setLocating(true);
    setGeoError(null);
    setGeoNotice(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await reverseGeoPlace(pos.coords.latitude, pos.coords.longitude, lang);
          if (res.notice) setGeoNotice(res.notice);
          if (res.place) {
            setSearchResults([res.place]);
            handleChoosePlace(res.place);
          } else {
            setGeoNotice(
              L(
                lang,
                'Position détectée sur la carte. Saisissez votre ville pour affiner les résultats.',
                'Coordinates located on the map. Enter your city to refine results.'
              )
            );
            mapInstanceRef.current?.setView(
              [pos.coords.latitude, pos.coords.longitude],
              11
            );
          }
        } catch {
          setGeoNotice(
            L(
              lang,
              'Coordonnées GPS détectées, mais le service Nominatim est momentanément ralenti.',
              'GPS coordinates detected, though Nominatim is temporarily busy.'
            )
          );
          mapInstanceRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 11);
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setGeoError(
          L(
            lang,
            'Accès à la position refusé. Sélectionnez directement votre pays et votre ville ci-dessous.',
            'Location permission denied. Select your country and city manually below.'
          )
        );
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  return (
    <section className="bg-white border border-jf-border rounded-xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-jf-border">
        <div className="space-y-1">
          <h3 className="font-display text-base sm:text-lg font-semibold text-jf-navy flex items-center gap-2">
            <Compass className="w-5 h-5 text-jf-blue shrink-0" />
            <span>
              {L(
                lang,
                'Carte Interactive des Entreprises & Opportunités (OpenStreetMap)',
                'Interactive Companies & Opportunities Map (OpenStreetMap)'
              )}
            </span>
          </h3>
          <p className="text-xs text-slate-600 max-w-2xl">
            {L(
              lang,
              'Sélectionnez un pays et une ville, géolocalisez une adresse via Nominatim et visualisez les pôles d’emploi et entreprises directement sur OpenStreetMap.',
              'Select a country and city, search addresses via Nominatim, and explore job hubs and companies on OpenStreetMap.'
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={handleDetectMyLocation}
          disabled={locating}
          className="px-3 py-2 text-xs font-medium text-jf-navy bg-jf-ice hover:bg-jf-soft border border-jf-border rounded-lg inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          {locating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-jf-blue" />
          ) : (
            <LocateFixed className="w-3.5 h-3.5 text-jf-blue" />
          )}
          <span>{L(lang, 'Ma position', 'My Location')}</span>
        </button>
      </div>

      {/* Country, City & Address Search Form */}
      <form onSubmit={handleSearchLocation} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
        <label className="lg:col-span-3 block space-y-1">
          <span className="text-xs font-medium text-slate-600">
            {L(lang, 'Pays', 'Country')}
          </span>
          <input
            type="text"
            list="jf-osm-countries"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder={L(lang, 'France, Canada, Suisse…', 'France, Canada, Switzerland…')}
            className="w-full px-3 py-2 text-sm bg-white border border-jf-border rounded-lg focus:outline-none focus:ring-2 focus:ring-jf-blue"
          />
          <datalist id="jf-osm-countries">
            {POPULAR_COUNTRIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="lg:col-span-3 block space-y-1">
          <span className="text-xs font-medium text-slate-600">
            {L(lang, 'Ville', 'City')}
          </span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={L(lang, 'Paris, Montréal, Zurich…', 'Paris, Montreal, Zurich…')}
            className="w-full px-3 py-2 text-sm bg-white border border-jf-border rounded-lg focus:outline-none focus:ring-2 focus:ring-jf-blue"
          />
        </label>

        <label className="lg:col-span-4 block space-y-1">
          <span className="text-xs font-medium text-slate-600">
            {L(lang, 'Adresse, quartier ou entreprise (optionnel)', 'Address, district, or company (optional)')}
          </span>
          <input
            type="text"
            value={addressQuery}
            onChange={(e) => setAddressQuery(e.target.value)}
            placeholder={L(
              lang,
              'ex. La Défense, Station F, Technopole…',
              'e.g. Canary Wharf, Downtown, Station F…'
            )}
            className="w-full px-3 py-2 text-sm bg-white border border-jf-border rounded-lg focus:outline-none focus:ring-2 focus:ring-jf-blue"
          />
        </label>

        <div className="lg:col-span-2 flex items-end">
          <button
            type="submit"
            disabled={searching}
            className="w-full px-3.5 py-2 text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>{L(lang, 'Localiser', 'Locate')}</span>
          </button>
        </div>
      </form>

      {/* Action Bar: Search Opportunities for Selected Country & City */}
      {(country.trim() || city.trim()) && onSearchOpportunities && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-jf-ice border border-jf-border rounded-lg">
          <div className="flex items-center gap-2 text-xs text-jf-navy">
            <MapPin className="w-4 h-4 text-jf-blue shrink-0" />
            <span>
              {L(lang, 'Zone sélectionnée :', 'Selected location:')}{' '}
              <strong>{[city.trim(), country.trim()].filter(Boolean).join(', ')}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              onSearchOpportunities({ country: country.trim(), city: city.trim() })
            }
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg inline-flex items-center gap-1.5 transition-colors"
          >
            <Briefcase className="w-3.5 h-3.5 text-jf-sky" />
            <span>
              {L(
                lang,
                'Rechercher les opportunités dans cette zone',
                'Search Opportunities in This Area'
              )}
            </span>
          </button>
        </div>
      )}

      {geoError && (
        <div
          role="alert"
          className="p-3 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-xs font-medium text-jf-navy"
        >
          {geoError}
        </div>
      )}

      {geoNotice && (
        <div className="p-3 bg-jf-ice border border-jf-sky/70 rounded-lg text-xs text-jf-dark inline-flex items-center gap-2 w-full">
          <Info className="w-4 h-4 text-jf-blue shrink-0" />
          <span>{geoNotice}</span>
        </div>
      )}

      {/* Interactive Leaflet + OpenStreetMap Map Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-jf-border bg-jf-ice">
        <div
          ref={mapContainerRef}
          className={compact ? 'h-[340px] w-full z-0' : 'h-[430px] w-full z-0'}
          aria-label={L(
            lang,
            'Carte interactive OpenStreetMap des entreprises et opportunités',
            'Interactive OpenStreetMap of companies and opportunities'
          )}
        />

        {/* Compact Map Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 bg-white border-t border-jf-border text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-jf-navy inline-block" />
              <span>{L(lang, 'Zone sélectionnée', 'Selected location')}</span>
            </span>
            {groupedJobPins.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-jf-blue inline-block" />
                <span>
                  {L(lang, 'Offres d’emploi', 'Job opportunities')} ({groupedJobPins.length}{' '}
                  {L(lang, 'villes', 'cities')})
                </span>
              </span>
            )}
            {resolvedCompanyPins.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-jf-dark inline-block" />
                <span>
                  {L(lang, 'Entreprises suivies', 'Monitored companies')} (
                  {resolvedCompanyPins.length})
                </span>
              </span>
            )}
          </div>
          <span className="font-mono text-[10px] text-slate-500">
            OpenStreetMap · Leaflet · Nominatim
          </span>
        </div>
      </div>

      {/* Nominatim Search Suggestions / Matching Locations */}
      {searchResults.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-jf-navy">
            {L(lang, 'Localisations trouvées', 'Matching Locations')} ({searchResults.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {searchResults.map((place) => {
              const isSelected = selectedPlace?.id === place.id;
              const safeOsm = safeExternalUrl(place.osmUrl);
              return (
                <div
                  key={place.id}
                  className={`p-3 rounded-lg border transition-colors flex items-start justify-between gap-2 ${
                    isSelected
                      ? 'bg-jf-soft/60 border-jf-blue'
                      : 'bg-jf-ice/50 border-jf-border hover:bg-jf-ice'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleChoosePlace(place)}
                    className="text-left min-w-0 flex-1 space-y-0.5"
                  >
                    <div className="text-xs font-semibold text-jf-navy flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-jf-blue shrink-0" />
                      <span className="truncate">
                        {place.city}
                        {place.country && place.country !== place.city ? `, ${place.country}` : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-1">{place.displayName}</p>
                    <div className="text-[10px] font-mono text-slate-500">
                      {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
                    </div>
                  </button>
                  {safeOsm && (
                    <a
                      href={safeOsm}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-jf-blue hover:underline inline-flex items-center gap-0.5 shrink-0 pt-0.5"
                    >
                      <span>OSM</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
