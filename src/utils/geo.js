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

let googleMapsLoaderPromise = null;

/**
 * Dynamically loads Google Maps JavaScript API on demand (saves ~250kB on initial page load).
 */
export async function loadGoogleMaps() {
  if (typeof window === 'undefined') return null;
  if (window.google && window.google.maps) {
    return window.google.maps;
  }
  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google?.maps));
      existingScript.addEventListener('error', (err) => {
        googleMapsLoaderPromise = null;
        reject(err);
      });
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyDFaOVxf6QfK03rRTVfIH84HLc5Qujzrew&libraries=places&language=es&region=AR';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      resolve(window.google?.maps);
    };
    script.onerror = (err) => {
      googleMapsLoaderPromise = null;
      reject(err);
    };
    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

const geocodeCache = new Map();

/**
 * Geocodes an address string to { lat, lng } using Google Maps (on-demand) with Nominatim fallback.
 */
export async function geocodeAddress(address) {
  if (!address) return null;
  if (geocodeCache.has(address)) return geocodeCache.get(address);
  
  try {
    let query = address;
    if (!query.toLowerCase().includes('argentina')) {
      query += `, Magdalena, Buenos Aires, Argentina`;
    }

    // 1. Google Maps Geocoder (loaded on-demand)
    try {
      await loadGoogleMaps();
      if (window.google && window.google.maps && window.google.maps.Geocoder) {
        const geocoder = new window.google.maps.Geocoder();
        const result = await new Promise((resolve, reject) => {
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
      }
    } catch (gErr) {
      console.warn('Google Geocoding note, using fallback:', gErr);
    }

    // 2. OpenStreetMap Nominatim Fallback
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

const ALLOWED_LOCAL_ZONES = [
  'magdalena',
  'atalaya',
  'general mansilla',
  'mansilla',
  'bavio',
  'vieytes',
  'empalme magdalena',
  'empalme',
  'partido de magdalena',
  'b1913',
  '7101',
  '1913'
];

const DISALLOWED_LOCATION_TERMS = [
  'brandsen', 'coronel brandsen', 'la plata', 'berisso', 'ensenada',
  'capital federal', 'caba', 'ciudad autonoma de buenos aires', 'ciudad autónoma de buenos aires',
  'san isidro', 'vicente lopez', 'vicente lópez', 'avellaneda', 'quilmes', 'lanus', 'lanús',
  'lomas de zamora', 'moron', 'morón', 'san martin, buenos aires', 'san martín, buenos aires'
];

export function isLocalAddress(desc) {
  if (!desc) return false;
  const lower = desc.toLowerCase();
  for (const forbidden of DISALLOWED_LOCATION_TERMS) {
    if (lower.includes(forbidden) && !lower.includes('magdalena')) return false;
  }
  return ALLOWED_LOCAL_ZONES.some(zone => lower.includes(zone));
}

export async function searchAddressSuggestions(term) {
  if (!term || term.trim().length < 2) return [];
  
  const rawInput = term.trim();

  // 1. Preload Google Maps API if available
  try {
    await loadGoogleMaps();
  } catch (e) {
    console.warn('[searchAddressSuggestions] Google Maps load note:', e);
  }

  const results = [];
  const seenKeys = new Set();

  const addResult = (res) => {
    if (!res || !res.lat || !res.lng || !res.address) return;
    const key = `${Number(res.lat).toFixed(4)},${Number(res.lng).toFixed(4)}`;
    const nameKey = res.address.toLowerCase().trim();
    if (!seenKeys.has(key) && !seenKeys.has(nameKey)) {
      seenKeys.add(key);
      seenKeys.add(nameKey);
      results.push(res);
    }
  };

  // 2. Google Maps Geocoder & Places Autocomplete (Rooftop & Parcel precision)
  if (typeof window !== 'undefined' && window.google && window.google.maps) {
    try {
      const magBounds = new window.google.maps.LatLngBounds(
        new window.google.maps.LatLng(-35.35, -57.85),
        new window.google.maps.LatLng(-34.95, -57.20)
      );

      // A. Direct Geocoder query (High accuracy for street + number like "Miguens 1340" or "San Martin 500")
      if (window.google.maps.Geocoder) {
        const geocoder = new window.google.maps.Geocoder();
        let geocodeQuery = rawInput;
        if (!geocodeQuery.toLowerCase().includes('magdalena') && !geocodeQuery.toLowerCase().includes('atalaya') && !geocodeQuery.toLowerCase().includes('bavio')) {
          geocodeQuery += ', Magdalena';
        }
        geocodeQuery += ', Buenos Aires, Argentina';

        try {
          const geoData = await new Promise((resolve) => {
            geocoder.geocode({
              address: geocodeQuery,
              componentRestrictions: { country: 'AR' },
              bounds: magBounds
            }, (res, status) => {
              if (status === 'OK' && res && res.length > 0) resolve(res);
              else resolve([]);
            });
          });

          for (const item of geoData) {
            if (isLocalAddress(item.formatted_address)) {
              let street = '';
              let number = '';
              let neighborhood = '';
              let city = 'Magdalena';
              (item.address_components || []).forEach(comp => {
                if (comp.types.includes('route')) street = comp.long_name;
                if (comp.types.includes('street_number')) number = comp.long_name;
                if (comp.types.includes('sublocality') || comp.types.includes('neighborhood')) neighborhood = comp.long_name;
                if (comp.types.includes('locality')) city = comp.long_name;
              });

              let display = `${street} ${number}`.trim();
              if (!display) display = item.formatted_address.split(',')[0];
              if (city && !display.toLowerCase().includes(city.toLowerCase())) display += `, ${city}`;

              addResult({
                lat: item.geometry.location.lat(),
                lng: item.geometry.location.lng(),
                address: display,
                displayName: item.formatted_address
              });
            }
          }
        } catch(gErr) {
          console.warn('[searchAddressSuggestions] Direct geocoder error:', gErr);
        }
      }

      // B. Places Autocomplete Service (Autocomplete street names as user types)
      if (window.google.maps.places && window.google.maps.places.AutocompleteService) {
        const service = new window.google.maps.places.AutocompleteService();
        const queryWithZone = rawInput.toLowerCase().includes('magdalena') ? rawInput : `${rawInput}, Magdalena`;

        const predictions = await new Promise((resolve) => {
          service.getPlacePredictions({
            input: queryWithZone,
            locationBias: magBounds,
            componentRestrictions: { country: 'ar' }
          }, (preds, status) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && preds && preds.length > 0) {
              resolve(preds);
            } else {
              service.getPlacePredictions({
                input: rawInput,
                locationBias: magBounds,
                componentRestrictions: { country: 'ar' }
              }, (fbPreds, fbStatus) => {
                if (fbStatus === window.google.maps.places.PlacesServiceStatus.OK && fbPreds) {
                  resolve(fbPreds);
                } else {
                  resolve([]);
                }
              });
            }
          });
        });

        const filteredPredictions = (predictions || []).filter(pred => isLocalAddress(pred.description));

        if (filteredPredictions.length > 0 && window.google.maps.Geocoder) {
          const geocoder = new window.google.maps.Geocoder();
          await Promise.all(filteredPredictions.slice(0, 5).map(async (pred) => {
            try {
              const geoRes = await new Promise((res, rej) => {
                geocoder.geocode({ placeId: pred.place_id }, (r, s) => {
                  if (s === 'OK' && r && r[0]) res(r[0]);
                  else rej(new Error(s));
                });
              });
              if (geoRes) {
                let street = '';
                let number = '';
                (geoRes.address_components || []).forEach(comp => {
                  if (comp.types.includes('route')) street = comp.long_name;
                  if (comp.types.includes('street_number')) number = comp.long_name;
                });
                let display = `${street} ${number}`.trim();
                if (!display) display = pred.structured_formatting ? pred.structured_formatting.main_text : pred.description.split(',')[0];
                if (!display.toLowerCase().includes('magdalena')) display += ', Magdalena';

                addResult({
                  lat: geoRes.geometry.location.lat(),
                  lng: geoRes.geometry.location.lng(),
                  address: display,
                  displayName: pred.description
                });
              }
            } catch(e) {}
          }));
        }
      }

      if (results.length > 0) {
        return results.slice(0, 6);
      }
    } catch(gErr) {
      console.warn('Google Places suggestion error, using local fallback:', gErr);
    }
  }

  // 3. OpenStreetMap Nominatim Fallback (Bounded to Magdalena region -57.85,-34.95,-57.20,-35.40)
  try {
    let searchQuery = rawInput;
    if (!searchQuery.toLowerCase().includes('magdalena')) {
      searchQuery += `, Magdalena, Buenos Aires, Argentina`;
    }
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&viewbox=-57.85,-34.95,-57.20,-35.40&bounded=1&addressdetails=1&limit=5&accept-language=es`;
    const response = await fetch(nominatimUrl, {
      headers: { 'Accept-Language': 'es', 'User-Agent': 'GoDelivery/1.0' }
    });
    const data = await response.json();
    
    (data || [])
      .filter(item => isLocalAddress(item.display_name))
      .forEach(item => {
        const a = item.address || {};
        const street = a.road || a.pedestrian || a.suburb || '';
        const number = a.house_number || '';
        const neighborhood = a.neighbourhood || a.residential || '';
        const city = a.city || a.town || a.village || 'Magdalena';
        
        let display = `${street} ${number}`.trim();
        if (neighborhood && !display.includes(neighborhood)) display += ` (${neighborhood})`;
        if (city && !display.includes(city)) display += `, ${city}`;
        
        addResult({
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          address: display || item.display_name.split(',')[0],
          displayName: item.display_name
        });
      });
      
    return results.slice(0, 6);
  } catch (err) {
    console.error('Error querying Nominatim suggestions:', err);
    return results.slice(0, 6);
  }
}

/**
 * Resolves an address place ID or coordinates on-demand.
 */
export async function geocodePlaceId(placeId) {
  if (!placeId) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/details?place_id=${encodeURIComponent(placeId)}&format=json`);
    const data = await res.json();
    if (data && data.geometry && data.geometry.coordinates) {
      return {
        lat: data.geometry.coordinates[1],
        lng: data.geometry.coordinates[0]
      };
    }
  } catch(e) {}
  return null;
}



