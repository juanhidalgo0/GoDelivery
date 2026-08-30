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

const MAGDALENA_STREETS = [
  { name: 'José María Miguens', keys: ['miguens', 'jose maria miguens', 'josé maría miguens', 'jose miguens', 'mig', 'miguen'], lat: -35.0825, lng: -57.5118, dir: 'nw-se' },
  { name: 'Doctor Patricio Brenan', keys: ['brenan', 'patricio brenan', 'dr brenan', 'bre'], lat: -35.0818, lng: -57.5135, dir: 'nw-se' },
  { name: 'Bernardino Rivadavia', keys: ['rivadavia', 'bernardino rivadavia', 'riva', 'riv'], lat: -35.0810, lng: -57.5152, dir: 'nw-se' },
  { name: 'Goenaga', keys: ['goenaga', 'goen', 'goe'], lat: -35.0802, lng: -57.5132, dir: 'sw-ne' },
  { name: 'San Martín', keys: ['san martin', 'san martín', 'san mart', 'av san martin'], lat: -35.0825, lng: -57.5145, dir: 'sw-ne' },
  { name: 'Chacabuco', keys: ['chacabuco', 'chaca', 'chac'], lat: -35.0795, lng: -57.5160, dir: 'sw-ne' },
  { name: '25 de Mayo', keys: ['25 de mayo', '25 de may', 'veinticinco de mayo', '25 mayo'], lat: -35.0818, lng: -57.5175, dir: 'nw-se' },
  { name: 'Mariano Moreno', keys: ['moreno', 'mariano moreno', 'mor'], lat: -35.0835, lng: -57.5165, dir: 'sw-ne' },
  { name: 'Juan Lavalle', keys: ['lavalle', 'juan lavalle', 'lav'], lat: -35.0840, lng: -57.5150, dir: 'sw-ne' },
  { name: 'Ituzaingó', keys: ['ituzaingo', 'ituzaingó', 'itu'], lat: -35.0845, lng: -57.5130, dir: 'sw-ne' },
  { name: 'Coronel Pintos', keys: ['pintos', 'coronel pintos', 'pinto', 'pin'], lat: -35.0800, lng: -57.5110, dir: 'sw-ne' },
  { name: 'Manuel Rebufo', keys: ['rebufo', 'manuel rebufo', 'rebu'], lat: -35.0790, lng: -57.5125, dir: 'sw-ne' },
  { name: 'Viamonte', keys: ['viamonte', 'viam', 'via'], lat: -35.0780, lng: -57.5140, dir: 'sw-ne' },
  { name: 'Manuel Belgrano', keys: ['belgrano', 'manuel belgrano', 'belg'], lat: -35.0850, lng: -57.5160, dir: 'sw-ne' },
  { name: 'Caseros', keys: ['caseros', 'case', 'cas'], lat: -35.0855, lng: -57.5140, dir: 'sw-ne' },
  { name: 'Hipólito Yrigoyen', keys: ['yrigoyen', 'hipolito yrigoyen', 'hipólito yrigoyen', 'yri', 'irigoyen'], lat: -35.0815, lng: -57.5130, dir: 'nw-se' },
  { name: 'Adolfo Alsina', keys: ['alsina', 'adolfo alsina', 'als'], lat: -35.0860, lng: -57.5125, dir: 'sw-ne' },
  { name: 'Bartolomé Mitre', keys: ['mitre', 'bartolome mitre', 'bartolomé mitre'], lat: -35.0822, lng: -57.5105, dir: 'nw-se' },
  { name: 'Julio A. Roca', keys: ['roca', 'julio a roca', 'julio roca'], lat: -35.0865, lng: -57.5155, dir: 'sw-ne' },
  { name: 'Cornelio Saavedra', keys: ['saavedra', 'cornelio saavedra', 'saav'], lat: -35.0870, lng: -57.5135, dir: 'sw-ne' },
  { name: 'Juan José Castelli', keys: ['castelli', 'juan jose castelli', 'cast'], lat: -35.0875, lng: -57.5120, dir: 'sw-ne' },
  { name: 'General Paz', keys: ['general paz', 'gral paz', 'paz'], lat: -35.0880, lng: -57.5110, dir: 'sw-ne' },
  { name: 'Leandro N. Alem', keys: ['alem', 'leandro alem', 'leandro n alem'], lat: -35.0885, lng: -57.5130, dir: 'nw-se' },
  { name: 'Espora', keys: ['espora', 'comandante espora'], lat: -35.0890, lng: -57.5145, dir: 'nw-se' },
  { name: 'Garibaldi', keys: ['garibaldi'], lat: -35.0895, lng: -57.5160, dir: 'nw-se' },
  { name: 'Guido Spano', keys: ['guido spano', 'spano'], lat: -35.0900, lng: -57.5170, dir: 'nw-se' },
  { name: 'Riobamba', keys: ['riobamba', 'riob'], lat: -35.0770, lng: -57.5150, dir: 'sw-ne' },
  { name: 'Suipacha', keys: ['suipacha', 'suip'], lat: -35.0760, lng: -57.5140, dir: 'sw-ne' },
  { name: 'Maipú', keys: ['maipu', 'maipú'], lat: -35.0750, lng: -57.5130, dir: 'sw-ne' },
  { name: 'Salta', keys: ['salta'], lat: -35.0740, lng: -57.5120, dir: 'sw-ne' },
  { name: 'Jujuy', keys: ['jujuy'], lat: -35.0730, lng: -57.5110, dir: 'sw-ne' },
  { name: 'Tucumán', keys: ['tucuman', 'tucumán'], lat: -35.0720, lng: -57.5100, dir: 'sw-ne' },
  { name: 'Barrio Eva Perón', keys: ['eva peron', 'barrio eva', 'eva'], lat: -35.0667, lng: -57.5378, dir: 'nw-se' },
  { name: 'Barrio San José', keys: ['san jose', 'barrio san jose', 'san jose'], lat: -35.0744, lng: -57.5255, dir: 'nw-se' },
  { name: 'Barrio 22 de Mayo', keys: ['22 de mayo', 'barrio 22 de mayo'], lat: -35.0710, lng: -57.5300, dir: 'nw-se' },
  { name: 'Barrio Obrero', keys: ['barrio obrero', 'obrero'], lat: -35.0880, lng: -57.5200, dir: 'nw-se' },
  { name: 'Empalme Magdalena', keys: ['empalme', 'empalme magdalena'], lat: -35.0933, lng: -57.5410, dir: 'nw-se' },
  { name: 'Atalaya', keys: ['atalaya', 'balneario atalaya'], lat: -35.0225, lng: -57.5369, dir: 'nw-se' },
  { name: 'General Mansilla (Bavio)', keys: ['bavio', 'general mansilla', 'mansilla'], lat: -35.0761, lng: -57.7536, dir: 'nw-se' },
  { name: 'Hipólito Vieytes', keys: ['vieytes', 'hipolito vieytes', 'hipólito vieytes'], lat: -35.2815, lng: -57.5758, dir: 'nw-se' }
];

const LOCAL_ZONE_KEYWORDS = ['magdalena', 'bavio', 'general mansilla', 'atalaya', 'vieytes', 'empalme', '7101'];

const DISALLOWED_LOCATION_TERMS = [
  'capital federal', 'caba', 'ciudad autonoma de buenos aires', 'ciudad autónoma de buenos aires',
  'san isidro', 'vicente lopez', 'vicente lópez', 'avellaneda', 'quilmes', 'lanus', 'lanús',
  'lomas de zamora', 'moron', 'morón', 'san martin, buenos aires', 'san martín, buenos aires'
];

function isLocalAddress(desc) {
  if (!desc) return false;
  const lower = desc.toLowerCase();
  for (const forbidden of DISALLOWED_LOCATION_TERMS) {
    if (lower.includes(forbidden)) return false;
  }
  return true;
}

export async function searchAddressSuggestions(term) {
  if (!term || term.trim().length < 2) return [];
  
  const rawInput = term.trim();
  const normalizedTerm = rawInput.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Extract any numbers typed by the user (e.g., "mig 1250" -> number = 1250, cleanTerm = "mig")
  const numberMatch = rawInput.match(/\b\d{1,5}\b/);
  const houseNumber = numberMatch ? numberMatch[0] : '';
  const numVal = houseNumber ? parseInt(houseNumber, 10) : 0;
  const textWithoutNumber = normalizedTerm.replace(/\b\d{1,5}\b/g, '').replace(/,/g, ' ').trim();

  const localMatches = [];
  
  // 1. Check local Magdalena street dictionary with block calculation
  for (const item of MAGDALENA_STREETS) {
    const isMatch = item.keys.some(k => {
      if (textWithoutNumber.length >= 2 && k.includes(textWithoutNumber)) return true;
      if (k.length >= 2 && textWithoutNumber.includes(k)) return true;
      return false;
    });

    if (isMatch) {
      let finalLat = item.lat;
      let finalLng = item.lng;

      if (numVal > 0) {
        const offset = (numVal - 500) / 100;
        if (item.dir === 'nw-se') {
          finalLat += offset * 0.00065;
          finalLng += offset * 0.00075;
        } else {
          finalLat += offset * 0.00075;
          finalLng -= offset * 0.00065;
        }
      }

      if (houseNumber) {
        localMatches.push({
          lat: Number(finalLat.toFixed(6)),
          lng: Number(finalLng.toFixed(6)),
          address: `${item.name} ${houseNumber}, Magdalena`,
          displayName: `${item.name} ${houseNumber}, Magdalena, Buenos Aires, Argentina`
        });
      } else {
        localMatches.push({
          lat: Number(item.lat.toFixed(6)),
          lng: Number(item.lng.toFixed(6)),
          address: `${item.name}, Magdalena`,
          displayName: `${item.name}, Magdalena, Buenos Aires, Argentina`
        });
      }
    }
  }

  // If local dictionary returned matches, return them immediately (0 ms response)
  if (localMatches.length > 0) {
    return localMatches.slice(0, 6);
  }

  // Bounded OpenStreetMap Nominatim search for Magdalena region (-57.85,-34.95,-57.20,-35.40)
  try {
    let searchQuery = term.trim();
    if (!searchQuery.toLowerCase().includes('magdalena')) {
      searchQuery += `, Magdalena, Buenos Aires, Argentina`;
    }
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&viewbox=-57.85,-34.95,-57.20,-35.40&bounded=1&addressdetails=1&limit=5&accept-language=es`;
    const response = await fetch(nominatimUrl, {
      headers: { 'Accept-Language': 'es' }
    });
    const data = await response.json();
    
    const mapped = (data || [])
      .filter(item => isLocalAddress(item.display_name))
      .map(item => {
        const a = item.address || {};
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
      
    return [...localMatches, ...mapped].slice(0, 6);
  } catch (err) {
    console.error('Error querying Nominatim suggestions:', err);
    return localMatches;
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


