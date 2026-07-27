// GoDelivery — Geolocation & Distance Utilities
// Uses Haversine formula for distance and Nominatim for geocoding

/**
 * Calculates straight line distance synchronously (Haversine formula)
 * to avoid network requests and rate limits on list views.
 */
export function getQuickDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
  const R = 6371; // Earth's radius in KM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1.25; // Apply correction factor for driving routes
}

/**
 * Calculates straight line distance with a driving routes correction factor.
 * Unified to guarantee 100% pricing consistency across all screens without network lag or API costs.
 */
export async function getDistance(lat1, lon1, lat2, lon2) {
  return getQuickDistance(lat1, lon1, lat2, lon2);
}

const geocodeCache = new Map();

/**
 * Geocodes an address string to { lat, lng } using OpenStreetMap Nominatim
 * Note: Nominatim has usage limits. For production, consider Google Maps or Mapbox.
 */
export async function geocodeAddress(address) {
  if (!address) return null;
  if (geocodeCache.has(address)) return geocodeCache.get(address);
  
  try {
    let query = address;
    if (!query.toLowerCase().includes('argentina')) {
      query += `, Magdalena, Buenos Aires, Argentina`;
    }

    // Google Maps Geocoder Attempt
    if (window.google && window.google.maps && window.google.maps.Geocoder) {
      try {
        const result = await new Promise((resolve, reject) => {
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ address: query }, (results, status) => {
            if (status === 'OK' && results && results[0]) {
              resolve({
                lat: results[0].geometry.location.lat(),
                lng: results[0].geometry.location.lng(),
                displayName: results[0].formatted_address
              });
            } else {
              reject(new Error("Google Geocode status: " + status));
            }
          });
        });
        geocodeCache.set(address, result);
        return result;
      } catch (gErr) {
        console.warn('Google Geocoding failed, falling back to Nominatim:', gErr);
      }
    }

    // Passive Nominatim Fallback
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1`);
    const data = await response.json();
    
    if (data && data.length > 0) {
      const result = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name
      };
      geocodeCache.set(address, result);
      return result;
    }
  } catch (err) {
    console.error('Geocoding error:', err);
  }
  return null;
}

import { getState } from '../state.js';

/**
 * Calculates delivery fee based on distance and state settings
 */
export function calculateDynamicFee(distanceKm) {
  const state = getState();
  
  // 1. Check multi-tier distance fixed rules (e.g., limitKm: 5 -> price: 3000)
  const rules = state.deliveryDistanceRules || [];
  if (rules.length > 0) {
    // Sort rules descending by limitKm to match the highest threshold first
    const sortedRules = [...rules].sort((a, b) => b.limitKm - a.limitKm);
    for (const rule of sortedRules) {
      if (distanceKm >= rule.limitKm) {
        return Math.ceil(rule.price / 10) * 10;
      }
    }
  }

  // 2. Fallback to legacy single fixed threshold if configured
  const fixedThreshold = state.deliveryFixedThresholdKm;
  const fixedPrice = state.deliveryFixedThresholdPrice;
  if (fixedThreshold !== undefined && fixedPrice !== undefined && fixedThreshold > 0 && fixedPrice > 0) {
    if (distanceKm >= fixedThreshold) {
      return Math.ceil(fixedPrice / 10) * 10;
    }
  }

  const basePrice = state.deliveryBasePrice || 1500;
  const pricePerKm = state.deliveryPricePerKm || 300;
  const minPrice = state.deliveryMinPrice || 1500;
  
  const roadDistance = distanceKm;
  
  // Logic: Base Price + (Road Distance * PricePerKm)
  const calculated = basePrice + (roadDistance * pricePerKm);
  let total = Math.max(minPrice, calculated);

  // Round to nearest 10 for clean prices
  return Math.ceil(total / 10) * 10;
}

const LOCAL_GEO_DICT = [
  {
    keys: ['eva peron', 'barrio eva'],
    address: 'Barrio Eva Perón, Magdalena',
    displayName: 'Barrio Eva Perón, Magdalena, Buenos Aires, Argentina',
    lat: -35.0667,
    lng: -57.5378
  },
  {
    keys: ['san jose', 'barrio san jose'],
    address: 'Barrio San José, Magdalena',
    displayName: 'Barrio San José, Magdalena, Buenos Aires, Argentina',
    lat: -35.0744,
    lng: -57.5255
  },
  {
    keys: ['empalme', 'empalme magdalena'],
    address: 'Empalme Magdalena, Magdalena',
    displayName: 'Empalme Magdalena, Magdalena, Buenos Aires, Argentina',
    lat: -35.0933,
    lng: -57.5410
  },
  {
    keys: ['bavio', 'general mansilla', 'mansilla'],
    address: 'General Mansilla (Bavio), Magdalena',
    displayName: 'General Mansilla (Bavio), Magdalena, Buenos Aires, Argentina',
    lat: -35.0761,
    lng: -57.7536
  },
  {
    keys: ['atalaya'],
    address: 'Atalaya, Magdalena',
    displayName: 'Atalaya, Magdalena, Buenos Aires, Argentina',
    lat: -35.0225,
    lng: -57.5369
  },
  {
    keys: ['vieytes', 'hipolito vieytes'],
    address: 'Hipólito Vieytes, Magdalena',
    displayName: 'Hipólito Vieytes, Magdalena, Buenos Aires, Argentina',
    lat: -35.2815,
    lng: -57.5758
  }
];

// Palabras clave de localidades permitidas en la zona de Magdalena y alrededores
const LOCAL_ZONE_KEYWORDS = ['magdalena', 'bavio', 'general mansilla', 'atalaya', 'vieytes', 'empalme', '7101'];

// Exclusiones explícitas de Capital Federal y zonas distantes
const DISALLOWED_LOCATION_TERMS = [
  'capital federal', 'caba', 'ciudad autonoma de buenos aires', 'ciudad autónoma de buenos aires',
  'san isidro', 'vicente lopez', 'vicente lópez', 'avellaneda', 'quilmes', 'lanus', 'lanús',
  'lomas de zamora', 'moron', 'morón', 'san martin, buenos aires', 'san martín, buenos aires'
];

/**
 * Checks if a suggestion string or object belongs to the Magdalena region
 */
function isLocalAddress(desc) {
  if (!desc) return false;
  const lower = desc.toLowerCase();
  
  // Reject if it mentions Capital Federal or distant CABA municipalities
  for (const forbidden of DISALLOWED_LOCATION_TERMS) {
    if (lower.includes(forbidden)) return false;
  }
  return true;
}

/**
 * Searches address suggestions scoped strictly to Magdalena, Empalme, Atalaya, Bavio, Vieytes and surroundings.
 */
export async function searchAddressSuggestions(term) {
  if (!term || term.trim().length < 2) return [];
  
  // 1. Check local dictionary first
  const normalizedTerm = term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const localMatches = [];
  
  for (const item of LOCAL_GEO_DICT) {
    const matchesKey = item.keys.some(k => k.includes(normalizedTerm) || normalizedTerm.includes(k));
    if (matchesKey) {
      let cleanTyped = term.trim();
      cleanTyped = cleanTyped.replace(/,?\s*(magdalena|bavio|atalaya|vieytes|empalme).*/i, '');
      
      localMatches.push({
        lat: item.lat,
        lng: item.lng,
        address: cleanTyped ? `${cleanTyped}, ${item.address}` : item.address,
        displayName: item.displayName
      });
    }
  }

  try {
    const hasLocalContext = LOCAL_ZONE_KEYWORDS.some(k => normalizedTerm.includes(k));
    let searchQuery = term.trim();
    if (!hasLocalContext) {
      searchQuery += `, Magdalena, Buenos Aires, Argentina`;
    }

    // Return local dictionary matches immediately if available for instant response
    if (localMatches.length > 0 && !normalizedTerm.includes('calle')) {
      return localMatches;
    }

    // Google Places Autocomplete Attempt
    if (window.google && window.google.maps && window.google.maps.places) {
      try {
        console.log('[Autocomplete] Attempting Google Maps autocomplete for local area...');
        let predictions = null;

        const magdalenaBounds = {
          north: -34.95,
          south: -35.40,
          east: -57.20,
          west: -57.85
        };

        // Try modern fetchAutocompleteSuggestions (Places API v1) first
        if (window.google.maps.places.AutocompleteSuggestion) {
          try {
            const response = await Promise.race([
              window.google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: searchQuery,
                locationRestriction: magdalenaBounds
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Google Modern API timeout')), 400))
            ]);
            if (response && response.suggestions) {
              predictions = response.suggestions.map(s => {
                const p = s.placePrediction;
                return {
                  place_id: p.placeId,
                  description: p.text ? p.text.toString() : '',
                  main_text: p.text && p.text.mainText ? p.text.mainText.text : ''
                };
              });
            }
          } catch (modernErr) {
            console.log('[Places API] Modern autocomplete fallback:', modernErr.message || modernErr);
          }
        }

        // Fallback to legacy AutocompleteService with strict bounds
        if (!predictions && window.google.maps.places.AutocompleteService) {
          predictions = await Promise.race([
            new Promise((resolve, reject) => {
              const service = new window.google.maps.places.AutocompleteService();
              const boundsObj = new window.google.maps.LatLngBounds(
                { lat: magdalenaBounds.south, lng: magdalenaBounds.west },
                { lat: magdalenaBounds.north, lng: magdalenaBounds.east }
              );
              service.getPlacePredictions({
                input: searchQuery,
                bounds: boundsObj,
                strictBounds: true,
                componentRestrictions: { country: 'ar' }
              }, (preds, status) => {
                if (status === 'OK' && preds) {
                  resolve(preds);
                } else {
                  reject(new Error("Google Autocomplete status: " + status));
                }
              });
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Google Legacy API timeout')), 1500))
          ]);
        }

        if (predictions && predictions.length > 0) {
          const filteredResults = predictions
            .filter(pred => isLocalAddress(pred.description || pred.main_text))
            .slice(0, 5)
            .map(pred => ({
              placeId: pred.place_id,
              address: pred.main_text || pred.description.split(',')[0],
              displayName: pred.description
            }));

          if (filteredResults.length > 0 || localMatches.length > 0) {
            console.log('[Autocomplete] Returning filtered Google predictions:', filteredResults.length);
            return [...localMatches, ...filteredResults];
          }
        }
      } catch (gErr) {
        console.warn('[Autocomplete] Google autocomplete pipeline failed, using Nominatim fallback:', gErr.message || gErr);
      }
    }

    // Passive Nominatim Fallback strictly bounded to Magdalena region (-57.85,-34.95,-57.20,-35.40)
    console.log('[Autocomplete] Querying Nominatim for address search...', searchQuery);
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&viewbox=-57.85,-34.95,-57.20,-35.40&bounded=1&addressdetails=1&limit=5&accept-language=es`;
    const response = await fetch(nominatimUrl, {
      headers: { 'Accept-Language': 'es' }
    });
    const data = await response.json();
    
    const mapped = (data || [])
      .filter(item => isLocalAddress(item.display_name))
      .map(item => {
        const a = item.address;
        const street = a.road || a.pedestrian || a.suburb || '';
        const number = a.house_number || '';
        const neighborhood = a.neighbourhood || a.residential || '';
        const city = a.city || a.town || a.village || 'Magdalena';
        
        let display = `${street} ${number}`.trim();
        if (neighborhood && !display.includes(neighborhood)) display += ` (${neighborhood})`;
        if (city && !display.includes(city)) display += `, ${city}`;
        
        return {
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          address: display || item.display_name.split(',')[0],
          displayName: item.display_name
        };
      });
      
    return [...localMatches, ...mapped];
  } catch (err) {
    console.error('Error searching suggestions:', err);
    return localMatches;
  }
}

/**
 * Resolves a Google Maps place ID to lat/lng coordinates on-demand.
 */
export async function geocodePlaceId(placeId) {
  if (!placeId) return null;
  if (window.google && window.google.maps && window.google.maps.Geocoder) {
    return new Promise((resolve) => {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ placeId }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
          resolve({
            lat: results[0].geometry.location.lat(),
            lng: results[0].geometry.location.lng()
          });
        } else {
          console.error('[Geocode] Failed to geocode place ID:', placeId, 'Status:', status);
          resolve(null);
        }
      });
    });
  }
  return null;
}


