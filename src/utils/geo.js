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
  
  const basePrice = state.deliveryBasePrice || 1500;
  const pricePerKm = state.deliveryPricePerKm || 300;
  const minPrice = state.deliveryMinPrice || 1500;
  
  const roadDistance = distanceKm;
  
  // Logic: Base Price + (Road Distance * PricePerKm)
  const calculated = basePrice + (roadDistance * pricePerKm);
  const total = Math.max(minPrice, calculated);
  
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

/**
 * Searches OpenStreetMap Nominatim for local address suggestions,
 * automatically scoping the query to Magdalena, Buenos Aires, Argentina.
 */
export async function searchAddressSuggestions(term) {
  if (!term || term.trim().length < 3) return [];
  
  // 1. Check local dictionary first
  const normalizedTerm = term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const localMatches = [];
  
  for (const item of LOCAL_GEO_DICT) {
    const matchesKey = item.keys.some(k => normalizedTerm.includes(k));
    if (matchesKey) {
      let cleanTyped = term.trim();
      cleanTyped = cleanTyped.replace(/,?\s*magdalena.*/i, '');
      
      localMatches.push({
        lat: item.lat,
        lng: item.lng,
        address: `${cleanTyped}, Magdalena`,
        displayName: `${cleanTyped}, Magdalena, Buenos Aires, Argentina (Barrio Local)`
      });
    }
  }

  try {
    let query = term;
    if (!query.toLowerCase().includes('magdalena')) {
      query += `, Magdalena, Buenos Aires, Argentina`;
    }

    // Google Places Autocomplete Attempt
    if (window.google && window.google.maps && window.google.maps.places) {
      try {
        console.log('[Autocomplete] Attempting Google Maps autocomplete...');
        let predictions = null;

        // Try modern fetchAutocompleteSuggestions (Places API v1) first
        if (window.google.maps.places.AutocompleteSuggestion) {
          try {
            // Race the modern API with a 1.5s timeout
            const response = await Promise.race([
              window.google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: term,
                locationBias: { lat: -35.0811, lng: -57.5146 }
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Google Modern API timeout')), 1500))
            ]);
            if (response && response.suggestions) {
              predictions = response.suggestions.map(s => {
                const p = s.placePrediction;
                return {
                  place_id: p.placeId,
                  description: p.text.toString(),
                  main_text: p.text.mainText ? p.text.mainText.text : ''
                };
              });
              console.log('[Autocomplete] Google Modern API predictions found:', predictions.length);
            }
          } catch (modernErr) {
            console.log('[Places API] Modern autocomplete failed/not enabled, trying legacy AutocompleteService.', modernErr.message || modernErr);
          }
        }

        // Fallback to legacy AutocompleteService if new API not supported or failed
        if (!predictions && window.google.maps.places.AutocompleteService) {
          console.log('[Autocomplete] Attempting legacy AutocompleteService...');
          predictions = await Promise.race([
            new Promise((resolve, reject) => {
              const service = new window.google.maps.places.AutocompleteService();
              service.getPlacePredictions({
                input: term,
                locationBias: { radius: 10000, center: { lat: -35.0811, lng: -57.5146 } },
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
          console.log('[Autocomplete] Google Legacy predictions found:', predictions?.length || 0);
        }

        if (predictions && predictions.length > 0) {
          const geocoder = new window.google.maps.Geocoder();
          const results = await Promise.all(predictions.slice(0, 5).map(async (pred) => {
            try {
              const geoRes = await Promise.race([
                new Promise((res, rej) => {
                  geocoder.geocode({ placeId: pred.place_id }, (r, s) => {
                    if (s === 'OK' && r && r[0]) {
                      res(r[0]);
                    } else {
                      rej(new Error(s));
                    }
                  });
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Google Geocoder timeout')), 1200))
              ]);
              return {
                lat: geoRes.geometry.location.lat(),
                lng: geoRes.geometry.location.lng(),
                address: pred.main_text || pred.description.split(',')[0],
                displayName: pred.description
              };
            } catch (e) {
              return null;
            }
          }));
          const filtered = results.filter(Boolean);
          if (filtered.length > 0 || localMatches.length > 0) {
            console.log('[Autocomplete] Returning Google predictions:', filtered.length, 'local matches:', localMatches.length);
            return [...localMatches, ...filtered];
          }
        }
      } catch (gErr) {
        console.warn('[Autocomplete] Google autocomplete pipeline failed, falling back:', gErr.message || gErr);
      }
    }

    // Passive Nominatim Fallback
    console.log('[Autocomplete] Querying Nominatim for address search...', query);
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&accept-language=es`, {
      headers: {
        'Accept-Language': 'es'
      }
    });
    const data = await response.json();
    console.log('[Autocomplete] Nominatim returned results:', data.length);
    const mapped = data.map(item => {
      const a = item.address;
      const street = a.road || a.pedestrian || a.suburb || '';
      const number = a.house_number || '';
      const neighborhood = a.neighbourhood || a.residential || '';
      const city = a.city || a.town || a.village || '';
      
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

