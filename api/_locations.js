// Server copy of src/utils/philippines-locations.ts (data + overlap rules) for trusted matching.
// api/matching.test.js fails if this drifts from the TypeScript source.
export const PHILIPPINE_ISLAND_GROUPS = ['Luzon', 'Visayas', 'Mindanao'];

export const NATIONWIDE_OPTION = 'Anywhere in the Philippines';

export const PHILIPPINE_REGIONS_AND_LOCATIONS = [
  {
    region: 'National Capital Region (NCR)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Metro Manila (All Districts)',
      'Quezon City',
      'Manila City',
      'Makati City',
      'Taguig City',
      'Pasig City',
      'Mandaluyong City',
      'Caloocan City',
      'Parañaque City',
      'Pasay City',
      'Marikina City',
      'Las Piñas City',
      'Muntinlupa City',
      'Valenzuela City',
    ],
  },
  {
    region: 'Cordillera Administrative Region (CAR)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Baguio City',
      'Benguet',
      'Abra',
      'Ifugao',
      'Kalinga',
      'Mountain Province',
      'Apayao',
    ],
  },
  {
    region: 'Region I (Ilocos Region)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Ilocos Norte',
      'Ilocos Sur',
      'La Union',
      'Pangasinan',
      'Dagupan City',
    ],
  },
  {
    region: 'Region II (Cagayan Valley)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Cagayan',
      'Isabela',
      'Nueva Vizcaya',
      'Quirino',
      'Batanes',
    ],
  },
  {
    region: 'Region III (Central Luzon)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Pampanga',
      'Angeles City',
      'Bulacan',
      'Nueva Ecija',
      'Tarlac',
      'Zambales',
      'Olongapo City',
      'Bataan',
      'Aurora',
    ],
  },
  {
    region: 'Region IV-A (CALABARZON)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Cavite',
      'Laguna',
      'Batangas',
      'Rizal',
      'Quezon Province',
      'Antipolo City',
    ],
  },
  {
    region: 'Region IV-B (MIMAROPA)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Palawan',
      'Puerto Princesa City',
      'Oriental Mindoro',
      'Occidental Mindoro',
      'Marinduque',
      'Romblon',
    ],
  },
  {
    region: 'Region V (Bicol Region)',
    islandGroup: 'Luzon',
    provincesAndCities: [
      'Albay',
      'Legazpi City',
      'Camarines Sur',
      'Naga City',
      'Camarines Norte',
      'Sorsogon',
      'Catanduanes',
      'Masbate',
    ],
  },
  {
    region: 'Region VI (Western Visayas)',
    islandGroup: 'Visayas',
    provincesAndCities: [
      'Iloilo',
      'Iloilo City',
      'Negros Occidental',
      'Bacolod City',
      'Capiz',
      'Aklan (Boracay)',
      'Antique',
      'Guimaras',
    ],
  },
  {
    region: 'Region VII (Central Visayas)',
    islandGroup: 'Visayas',
    provincesAndCities: [
      'Cebu',
      'Cebu City',
      'Mandaue City',
      'Lapu-Lapu City',
      'Bohol',
      'Tagbilaran City',
      'Negros Oriental',
      'Dumaguete City',
      'Siquijor',
    ],
  },
  {
    region: 'Region VIII (Eastern Visayas)',
    islandGroup: 'Visayas',
    provincesAndCities: [
      'Leyte',
      'Tacloban City',
      'Southern Leyte',
      'Samar',
      'Eastern Samar',
      'Northern Samar',
      'Biliran',
    ],
  },
  {
    region: 'Region IX (Zamboanga Peninsula)',
    islandGroup: 'Mindanao',
    provincesAndCities: [
      'Zamboanga del Sur',
      'Zamboanga City',
      'Zamboanga del Norte',
      'Dipolog City',
      'Pagadian City',
      'Zamboanga Sibugay',
    ],
  },
  {
    region: 'Region X (Northern Mindanao)',
    islandGroup: 'Mindanao',
    provincesAndCities: [
      'Misamis Oriental',
      'Cagayan de Oro City',
      'Misamis Occidental',
      'Bukidnon',
      'Lanao del Norte',
      'Iligan City',
      'Camiguin',
    ],
  },
  {
    region: 'Region XI (Davao Region)',
    islandGroup: 'Mindanao',
    provincesAndCities: [
      'Davao del Sur',
      'Davao City',
      'Davao del Norte',
      'Tagum City',
      'Davao Oriental',
      'Davao de Oro',
      'Davao Occidental',
    ],
  },
  {
    region: 'Region XII (SOCCSKSARGEN)',
    islandGroup: 'Mindanao',
    provincesAndCities: [
      'South Cotabato',
      'General Santos City',
      'Cotabato Province',
      'Sultan Kudarat',
      'Sarangani',
    ],
  },
  {
    region: 'Region XIII (Caraga)',
    islandGroup: 'Mindanao',
    provincesAndCities: [
      'Agusan del Norte',
      'Butuan City',
      'Agusan del Sur',
      'Surigao del Norte',
      'Surigao del Sur',
      'Dinagat Islands',
    ],
  },
  {
    region: 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)',
    islandGroup: 'Mindanao',
    provincesAndCities: [
      'Maguindanao del Norte',
      'Maguindanao del Sur',
      'Cotabato City',
      'Lanao del Sur',
      'Marawi City',
      'Basilan',
      'Isabela City',
      'Sulu',
      'Tawi-Tawi',
    ],
  },
];

/**
 * Handles toggling location selections with mutual exclusivity for "Anywhere in the Philippines".
 */

/** Island group, region and place for a location option: ['Visayas', 'Region VII (Central Visayas)', 'Cebu City']. */
function locationPath(name) {
  if (PHILIPPINE_ISLAND_GROUPS.includes(name)) return [name];
  for (const group of PHILIPPINE_REGIONS_AND_LOCATIONS) {
    if (group.region === name) return [group.islandGroup, group.region];
    if (group.provincesAndCities.includes(name)) return [group.islandGroup, group.region, name];
  }
  return [name];
}

/**
 * Two location options overlap when one contains the other: 'Visayas' overlaps 'Cebu City',
 * 'Region VII (Central Visayas)' overlaps 'Cebu City', but 'Cebu City' and 'Bohol' don't.
 */
export function locationsOverlap(a, b) {
  if (a === NATIONWIDE_OPTION || b === NATIONWIDE_OPTION) return true;
  const pa = locationPath(a);
  const pb = locationPath(b);
  const [shorter, longer] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return shorter.every((part, i) => longer[i] === part);
}
