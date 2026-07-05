// src/apis/external/Aquavita/getMapsUbication.ts
import { Client } from "@googlemaps/google-maps-services-js";

/**
 * Obtiene la latitud y longitud de una dirección usando la API de Google Maps Geocoding.
 */
export async function getMapsUbication(
  calleYAltura: string,
  codigoPostal: string,
  _localidad: string,
  _provincia: string,
  _pais: string
) {
  const provinciaFija = "Cordoba";
  const pais = "Argentina";
  const localidadFija = "Ciudad de Cordoba";
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey) {
    console.error('No se encontró la API Key de Google Maps en las variables de entorno.');
    return null;
  }
  const address = `${calleYAltura}, ${codigoPostal} ${localidadFija}, ${provinciaFija}, ${pais}`;
  const client = new Client({});
  try {
    const response = await client.geocode({
      params: {
        address: address,
        key: apiKey,
      },
      timeout: 5000,
    });
    if (
      response.data.status === "OK" &&
      response.data.results &&
      response.data.results.length > 0
    ) {
      const location = response.data.results[0].geometry.location;
      const formattedAddress = response.data.results[0].formatted_address;
      return { lat: location.lat, lng: location.lng, formattedAddress: formattedAddress };
    } else {
      console.warn("No se encontró la ubicación para:", address);
      return null;
    }
  } catch (error) {
    console.error("Error consultando Google Maps Geocoding API:", error);
    return null;
  }
}
