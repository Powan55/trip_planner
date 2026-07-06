// Real confirmed bookings — read-only PRESENTATION data, deliberately
// kept separate from the user-editable, localStorage-persisted itinerary store.
// These are fixed reference facts about the trip (flight numbers,
// terminals, seats, the hotel); they are NOT an ItineraryItem/DayPlan and are NOT
// persisted. The only link to the itinerary is human-authored content agreement —
// never a shared type or store.
//
// HARD RULE: time/duration/total labels are rendered VERBATIM. There is no
// `Date` object, no parsing, no timezone math, no recompute anywhere in this module
// or its presenter. The booking is the source of truth for its own arithmetic — the
// outbound crosses the date line (totalDuration '1d 15m'), and "correcting" it would
// be a bug. `status: 'to-book'` / ToBookPlaceholder is the ONLY sanctioned way to
// show unbooked Japan logistics; they are never faked with invented numbers/hotels.

export type BookingStatus = 'booked' | 'to-book';
export type CabinClass = 'Economy' | 'Premium Economy' | 'Business' | 'First';

export interface FlightLeg {
  id: string;                 // stable, e.g. 'out-1', 'ret-2'
  flightNumber: string;       // 'Delta 5363', 'Air India 102', 'China Southern 3068'
  fromCode: string;           // 'SYR'
  fromName: string;           // 'Syracuse Hancock Intl'
  fromTerminal?: string;      // 'Terminal 4' (omit when not given)
  toCode: string;             // 'JFK'
  toName: string;             // 'New York JFK'
  toTerminal?: string;        // 'Terminal 4'
  departLabel: string;        // human label, exactly as the booking reads: '5:30am Wed Dec 9'
  arriveLabel: string;        // '7:02am Wed Dec 9'
  duration: string;           // '1h 32m'
  seats?: string[];           // ['11A','11B','11C']; omit on legs with no seats given
  cabin: CabinClass;          // 'Economy'
  cabinCode?: string;         // 'V','W','L' (fare/booking class letter from the booking)
}

export interface Layover {
  airportCode: string;        // 'JFK'
  airportName?: string;       // 'New York JFK'
  duration: string;           // '4h 53m'
}

export interface Journey {
  id: string;                 // 'outbound' | 'return-to-japan'
  label: string;              // 'Outbound — Syracuse to Kathmandu'
  status: BookingStatus;      // 'booked'
  fromSummary: string;        // 'Syracuse (SYR)'
  toSummary: string;          // 'Kathmandu (KTM)'
  totalDuration: string;      // render verbatim; do NOT recompute
  legs: FlightLeg[];          // ordered
  layovers: Layover[];        // ordered, length === legs.length - 1; positionally between legs[i] and legs[i+1]
}

export interface Stay {
  id: string;                 // 'nepal-hotel'
  name: string;               // 'Tulsi Kathmandu Hotel'
  stars: number | null;       // 3 (null only if genuinely unrated)
  address?: string;           // full street address when known
  area?: string;              // 'Keshar Mahal Marga — beside Garden of Dreams / Thamel'
  city: string;               // 'Kathmandu'
  country: 'nepal' | 'japan'; // lowercase, matching DayPlan.country
  status: BookingStatus;      // 'booked'
  checkIn?: string;           // optional human label; omit if not a fixed booking fact
  checkOut?: string;
}

export interface ToBookPlaceholder {
  id: string;                 // 'japan-hotels', 'flight-home'
  kind: 'stay' | 'flight';
  label: string;              // 'Japan accommodation', 'Flight home'
  note: string;               // 'Not booked yet — Dec 19 to Jan 9'
}

export const OUTBOUND_JOURNEY: Journey = {
  id: 'outbound', label: 'Outbound — Syracuse to Kathmandu', status: 'booked',
  fromSummary: 'Syracuse (SYR)', toSummary: 'Kathmandu (KTM)',
  totalDuration: '1d 15m',            // verbatim source string — render as-is, do NOT recompute
  legs: [
    { id: 'out-1', flightNumber: 'Delta 5363',
      fromCode: 'SYR', fromName: 'Syracuse Hancock Intl',
      toCode: 'JFK', toName: 'New York JFK', toTerminal: 'Terminal 4',
      departLabel: '5:30am Wed Dec 9', arriveLabel: '7:02am Wed Dec 9',
      duration: '1h 32m', seats: ['11A', '11B', '11C'], cabin: 'Economy', cabinCode: 'V' },
    { id: 'out-2', flightNumber: 'Air India 102',
      fromCode: 'JFK', fromName: 'New York JFK', fromTerminal: 'Terminal 4',
      toCode: 'DEL', toName: 'Delhi Indira Gandhi Intl', toTerminal: 'Terminal 3',
      departLabel: '11:55am Wed Dec 9', arriveLabel: '1:20pm Thu Dec 10',
      duration: '14h 55m', seats: ['31D', '31E', '31G'], cabin: 'Economy', cabinCode: 'W' },
    { id: 'out-3', flightNumber: 'Air India 219',
      fromCode: 'DEL', fromName: 'Delhi Indira Gandhi Intl', fromTerminal: 'Terminal 3',
      toCode: 'KTM', toName: 'Kathmandu Tribhuvan Intl', toTerminal: 'Terminal I',
      departLabel: '2:30pm Thu Dec 10', arriveLabel: '4:30pm Thu Dec 10',
      duration: '1h 45m', seats: ['26D', '26E', '26F'], cabin: 'Economy', cabinCode: 'W' },
  ],
  layovers: [
    { airportCode: 'JFK', airportName: 'New York JFK', duration: '4h 53m' },
    { airportCode: 'DEL', airportName: 'Delhi Indira Gandhi Intl', duration: '1h 10m' },
  ],
};

export const RETURN_TO_JAPAN_JOURNEY: Journey = {
  id: 'return-to-japan', label: 'Kathmandu to Tokyo', status: 'booked',
  fromSummary: 'Kathmandu (KTM)', toSummary: 'Tokyo (HND)',
  totalDuration: '10h 50m',
  legs: [
    { id: 'ret-1', flightNumber: 'China Southern 3068',
      fromCode: 'KTM', fromName: 'Kathmandu Tribhuvan Intl', fromTerminal: 'Terminal I',
      toCode: 'CAN', toName: 'Guangzhou Baiyun Intl', toTerminal: 'Terminal 2',
      departLabel: '11:30pm Fri Dec 18', arriveLabel: '5:55am Sat Dec 19',
      duration: '4h 10m', cabin: 'Economy', cabinCode: 'L' },   // no seats given — omit the seats line in UI
    { id: 'ret-2', flightNumber: 'China Southern 385',
      fromCode: 'CAN', fromName: 'Guangzhou Baiyun Intl', fromTerminal: 'Terminal 2',
      toCode: 'HND', toName: 'Tokyo Haneda', toTerminal: 'Terminal 3',
      departLabel: '8:50am Sat Dec 19', arriveLabel: '1:35pm Sat Dec 19',
      duration: '3h 45m', cabin: 'Economy', cabinCode: 'L' },   // no seats given
  ],
  layovers: [{ airportCode: 'CAN', airportName: 'Guangzhou Baiyun Intl', duration: '2h 55m' }],
};

export const NEPAL_STAY: Stay = {
  id: 'nepal-hotel', name: 'Tulsi Kathmandu Hotel', stars: 3,
  address: 'Keshar Mahal Marga, Kathmandu, Bagmati 44600',
  area: 'Keshar Mahal Marga — beside Garden of Dreams / Thamel',
  city: 'Kathmandu', country: 'nepal', status: 'booked',
};

export const JAPAN_TODO: ToBookPlaceholder[] = [
  { id: 'japan-hotels', kind: 'stay', label: 'Japan accommodation', note: 'Not booked yet — Dec 19 to Jan 9' },
  { id: 'flight-home', kind: 'flight', label: 'Flight home', note: 'Not booked yet — departs Tokyo Jan 9' },
];

// Convenience ordered list for the section to map over.
export const JOURNEYS: Journey[] = [OUTBOUND_JOURNEY, RETURN_TO_JAPAN_JOURNEY];
