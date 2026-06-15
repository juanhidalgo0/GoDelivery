// GoDelivery — Weather Service for Magdalena, BA
const MAGDALENA_COORDS = { lat: -35.0811, lng: -57.5146 };

/**
 * Checks in real-time if it is currently raining in Magdalena, Buenos Aires.
 * Uses the free public Open-Meteo API without requiring an API key.
 * @returns {Promise<boolean>}
 */
export async function isRainingInMagdalena() {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${MAGDALENA_COORDS.lat}&longitude=${MAGDALENA_COORDS.lng}&current=rain,weather_code`
    );
    if (!response.ok) {
      console.warn('[Weather] Open-Meteo API response not OK');
      return false;
    }
    const data = await response.json();
    const rain = data?.current?.rain || 0;
    const code = data?.current?.weather_code || 0;

    // Drizzle / Rain weather codes:
    // 51, 53, 55 (Drizzle: Light, moderate, dense intensity)
    // 56, 57 (Freezing Drizzle: Light, dense intensity)
    // 61, 63, 65 (Rain: Slight, moderate, heavy intensity)
    // 66, 67 (Freezing Rain: Light, heavy intensity)
    // 80, 81, 82 (Rain showers: Slight, moderate, violent)
    const rainCodes = [53, 55, 57, 61, 63, 65, 66, 67, 80, 81, 82];

    const isRaining = rain >= 0.5 || rainCodes.includes(code);
    console.log(`[Weather] Rain: ${rain}mm, Weather Code: ${code}. Raining: ${isRaining}`);
    return isRaining;
  } catch (err) {
    console.warn('[Weather] Error fetching weather from Open-Meteo:', err);
    return false;
  }
}
