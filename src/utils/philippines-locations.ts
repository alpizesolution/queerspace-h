export interface PhilippineLocationGroup {
  region: string;
  islandGroup: 'Luzon' | 'Visayas' | 'Mindanao';
  provincesAndCities: string[];
}

export const PHILIPPINE_ISLAND_GROUPS = ['Luzon', 'Visayas', 'Mindanao'] as const;

export const NATIONWIDE_OPTION = 'Anywhere in the Philippines';

export const PHILIPPINE_REGIONS_AND_LOCATIONS: PhilippineLocationGroup[] = [
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
export function toggleLocationPreference(
  current: string[] = ['Anywhere in the Philippines'],
  selected: string
): string[] {
  if (selected === 'Anywhere in the Philippines') {
    return ['Anywhere in the Philippines'];
  }

  const withoutNationwide = current.filter((item) => item !== 'Anywhere in the Philippines');
  let next: string[];
  if (withoutNationwide.includes(selected)) {
    next = withoutNationwide.filter((item) => item !== selected);
  } else {
    next = [...withoutNationwide, selected];
  }

  return next.length > 0 ? next : ['Anywhere in the Philippines'];
}

/**
 * Formats location preference summary for UI display.
 */
export function formatLocationSummary(locations: string[] = []): string {
  if (locations.length === 0 || locations.includes('Anywhere in the Philippines')) {
    return 'Anywhere in the Philippines';
  }
  if (locations.length <= 2) {
    return locations.join(', ');
  }
  return `${locations[0]}, ${locations[1]} +${locations.length - 2} more`;
}

/**
 * Checks if a partner's location matches the user's preferred locations.
 */
export function isLocationCompatible(
  userLocations: string[] = ['Anywhere in the Philippines'],
  partnerLocation: string = ''
): boolean {
  if (userLocations.length === 0 || userLocations.includes('Anywhere in the Philippines')) {
    return true;
  }
  if (!partnerLocation) {
    // Unset location is never excluded for privacy/inclusivity
    return true;
  }

  const normalizedPartner = partnerLocation.toLowerCase();

  for (const loc of userLocations) {
    const normLoc = loc.toLowerCase();
    if (normalizedPartner.includes(normLoc) || normLoc.includes(normalizedPartner)) {
      return true;
    }

    // Check island group match
    if (
      (normLoc === 'luzon' && isLuzonLocation(partnerLocation)) ||
      (normLoc === 'visayas' && isVisayasLocation(partnerLocation)) ||
      (normLoc === 'mindanao' && isMindanaoLocation(partnerLocation))
    ) {
      return true;
    }
  }

  return false;
}

function isLuzonLocation(loc: string): boolean {
  const l = loc.toLowerCase();
  return (
    l.includes('ncr') ||
    l.includes('manila') ||
    l.includes('quezon') ||
    l.includes('makati') ||
    l.includes('taguig') ||
    l.includes('pasig') ||
    l.includes('carm') ||
    l.includes('ilocos') ||
    l.includes('cagayan') ||
    l.includes('central luzon') ||
    l.includes('calabarzon') ||
    l.includes('mimaropa') ||
    l.includes('bicol') ||
    l.includes('baguio') ||
    l.includes('pampanga') ||
    l.includes('cavite') ||
    l.includes('laguna') ||
    l.includes('batangas') ||
    l.includes('rizal') ||
    l.includes('bulacan')
  );
}

function isVisayasLocation(loc: string): boolean {
  const l = loc.toLowerCase();
  return (
    l.includes('visayas') ||
    l.includes('cebu') ||
    l.includes('iloilo') ||
    l.includes('bacolod') ||
    l.includes('negros') ||
    l.includes('bohol') ||
    l.includes('tacloban') ||
    l.includes('leyte') ||
    l.includes('aklan') ||
    l.includes('capiz') ||
    l.includes('boracay')
  );
}

function isMindanaoLocation(loc: string): boolean {
  const l = loc.toLowerCase();
  return (
    l.includes('mindanao') ||
    l.includes('davao') ||
    l.includes('cagayan de oro') ||
    l.includes('zamboanga') ||
    l.includes('general santos') ||
    l.includes('butuan') ||
    l.includes('cotabato') ||
    l.includes('barmm') ||
    l.includes('sulu') ||
    l.includes('tawi-tawi') ||
    l.includes('agusan')
  );
}
