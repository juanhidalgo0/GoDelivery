// GoDelivery — Geolocation & Distance Utilities
// Uses Haversine formula for distance and Nominatim for geocoding

/**
 * Calculates real driving distance between two points using OSRM
 * Fallback to Haversine if API fails
 */
export async function getDistance(lat1, lon1, lat2, lon2) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    const resp = await fetch(url);
    const data = await resp.json();
    
    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      // OSRM returns distance in METERS
      return data.routes[0].distance / 1000; 
    }
  } catch (err) {
    console.warn('OSRM routing failed, falling back to Haversine:', err);
  }

  // Haversine fallback (Straight line)
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1.35; // Add estimation factor if we are in fallback mode
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

/**
 * Searches OpenStreetMap Nominatim for local address suggestions,
 * automatically scoping the query to Magdalena, Buenos Aires, Argentina.
 */
export async function searchAddressSuggestions(term) {
  if (!term || term.trim().length < 3) return [];
  try {
    let query = term;
    if (!query.toLowerCase().includes('magdalena')) {
      query += `, Magdalena, Buenos Aires, Argentina`;
    }

    // Google Places Autocomplete Attempt
    if (window.google && window.google.maps && window.google.maps.places && window.google.maps.places.AutocompleteService) {
      try {
        const predictions = await new Promise((resolve, reject) => {
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
        });

        if (predictions && predictions.length > 0) {
          const geocoder = new window.google.maps.Geocoder();
          const results = await Promise.all(predictions.slice(0, 5).map(async (pred) => {
            try {
              const geoRes = await new Promise((res, rej) => {
                geocoder.geocode({ placeId: pred.place_id }, (r, s) => {
                  if (s === 'OK' && r && r[0]) {
                    res(r[0]);
                  } else {
                    rej(new Error(s));
                  }
                });
              });
              return {
                lat: geoRes.geometry.location.lat(),
                lng: geoRes.geometry.location.lng(),
                address: pred.structured_formatting.main_text || pred.description.split(',')[0],
                displayName: pred.description
              };
            } catch (e) {
              return null;
            }
          }));
          const filtered = results.filter(Boolean);
          if (filtered.length > 0) return filtered;
        }
      } catch (gErr) {
        console.warn('Google Address suggestions failed, falling back to Nominatim:', gErr);
      }
    }

    // Passive Nominatim Fallback
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&accept-language=es`);
    const data = await response.json();
    return data.map(item => {
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
  } catch (err) {
    console.error('Error searching suggestions:', err);
    return [];
  }
}

