// Real confirmed bookings — read-only PRESENTATION data, deliberately
// kept separate from the user-editable, localStorage-persisted itinerary store
// These are fixed reference facts about the trip (flight numbers,
// terminals, seats, the hotel); they are NOT an ItineraryItem/DayPlan and are NOT
// persisted. The only link to the itinerary is human-authored content agreement
// — never a shared type or store.
//
// HARD RULE: time/duration/total labels are rendered VERBATIM. There is no
// `Date` object, no parsing, no timezone math, no recompute anywhere in this module
// or its presenter. The booking is the source of truth for its own arithmetic — the
// outbound crosses the date line (totalDuration '23h 56m'), and "correcting" it would
// be a bug. `'to-book'` exists as a `BookingStatus` member but NO record uses it,
// and none ever has. Adding one needs a rendering treatment that no longer exists
// for a journey: `FlightJourneyCard` does not read `status`, and the placeholder
// card was removed with `JAPAN_TODO` (#213). Bookings are never faked with
// invented numbers/hotels.

export type BookingStatus = 'booked' | 'to-book';
export type CabinClass = 'Economy' | 'Premium Economy' | 'Business' | 'First';

export interface FlightLeg {
  id: string;                 // stable, e.g. 'out-1', 'ret-2'
  flightNumber: string;       // 'Delta 5363', 'Air India 102', 'China Southern Airlines 3068'
  fromCode: string;           // 'SYR'
  fromName: string;           // 'Syracuse Hancock Intl'
  fromTerminal?: string;      // 'Terminal 4' (omit when not given)
  toCode: string;             // 'JFK'
  toName: string;             // 'New York JFK'
  toTerminal?: string;        // 'Terminal 4'
  departLabel: string;        // human label, exactly as the booking reads: '5:30am Wed Dec 9'
  arriveLabel: string;        // '7:02am Wed Dec 9'
  duration: string;           // '1h 32m'
  seats?: string[];           // e.g. ['14A','14B']; omit on legs with no seats given (only the outbound has them)
  cabin: CabinClass;          // 'Economy'
  cabinCode?: string;         // 'V','W','L' (fare/booking class letter from the booking)
}

export interface Layover {
  airportCode: string;        // 'JFK'
  airportName?: string;       // 'New York JFK'
  duration: string;           // '4h 53m'
  // AUTHORED human judgment of the connection's comfort. NOT derived from
  // `duration` — a naive minutes threshold can't see immigration / terminal-change
  // tightness (a 2h55m international→international hop is tighter than 6h domestic).
  // Absent → the UI shows the duration only. Never parsed; a static color/label record maps it.
  verdict?: 'relaxed' | 'normal' | 'tight';
}

export interface Journey {
  id: string;                 // 'outbound' | 'return-to-japan'
  label: string;              // 'Outbound — Syracuse to Kathmandu'
  status: BookingStatus;      // 'booked'
  fromSummary: string;        // 'Syracuse (SYR)'
  toSummary: string;          // 'Kathmandu (KTM)'
  totalDuration: string;      // render verbatim; do NOT recompute
  // AUTHORED date-only anchor for the phase strip + proximity countdown. A member
  // of TRIP_DATES; authored by READING the first leg's human `departLabel` (never computed
  // in code). Date-only — no time, no timezone, no `Date` object here — so it cannot recompute
  // the date-line-crossing time/duration/total labels protects. The card's trip-clock
  // (getNow + computeCountdown, core/dates) targets THIS, never a booking time label.
  departDate: string;         // 'YYYY-MM-DD'
  legs: FlightLeg[];          // ordered
  layovers: Layover[];        // ordered, length === legs.length - 1; positionally between legs[i] and legs[i+1]
}

export interface Stay {
  id: string;                 // 'nepal-hotel'
  name: string;               // 'Thamel Garden Hotel'
  stars: number | null;       // 3 (null only if genuinely unrated)
  address?: string;           // full street address when known
  area?: string;              // 'Thamel — beside Garden of Dreams'
  city: string;               // 'Kathmandu'
  country: 'nepal' | 'japan'; // lowercase, matching DayPlan.country
  status: BookingStatus;      // 'booked'
  checkIn?: string;           // optional human label; omit if not a fixed booking fact
  checkOut?: string;
  note?: string;              // short human-readable extra line (e.g. '5 nights · 3 adults · 3 rooms'); omit if nothing extra to show
}

export const OUTBOUND_JOURNEY: Journey = {
  id: 'outbound', label: 'Outbound — Syracuse to Kathmandu', status: 'booked',
  fromSummary: 'Syracuse (SYR)', toSummary: 'Kathmandu (KTM)',
  totalDuration: '23h 56m',           // verbatim from the booking source — render as-is, do NOT recompute
  departDate: '2026-12-09',           // authored from leg out-1 '5:29am Wed Dec 9' (= TRIP_DATES[0])
  legs: [
    { id: 'out-1', flightNumber: 'Delta 5363', seats: ['11A', '11B', '11C'],
      fromCode: 'SYR', fromName: 'Syracuse Hancock Intl',
      toCode: 'JFK', toName: 'New York JFK', toTerminal: 'Terminal 4',
      departLabel: '5:29am Wed Dec 9', arriveLabel: '7:03am Wed Dec 9',
      duration: '1h 34m', cabin: 'Economy', cabinCode: 'V' },
    { id: 'out-2', flightNumber: 'Air India 102', seats: ['31D', '31E', '31G'],
      fromCode: 'JFK', fromName: 'New York JFK', fromTerminal: 'Terminal 4',
      toCode: 'DEL', toName: 'Delhi Indira Gandhi Intl', toTerminal: 'Terminal 3',
      departLabel: '10:00am Wed Dec 9', arriveLabel: '11:40am Thu Dec 10',
      duration: '15h 10m', cabin: 'Economy', cabinCode: 'W' },
    { id: 'out-3', flightNumber: 'Air India 219', seats: ['26D', '26E', '26F'],
      fromCode: 'DEL', fromName: 'Delhi Indira Gandhi Intl', fromTerminal: 'Terminal 3',
      toCode: 'KTM', toName: 'Kathmandu Tribhuvan Intl', toTerminal: 'Terminal I',
      departLabel: '2:00pm Thu Dec 10', arriveLabel: '4:10pm Thu Dec 10',
      duration: '1h 55m', cabin: 'Economy', cabinCode: 'W' },
  ],
  layovers: [
    // 2h57m at JFK, same-terminal (T4) onward — but the onward leg is the 15h long-haul, so it is
    // a bag-recheck-free walk with no slack to spare if the regional inbound slips.
    { airportCode: 'JFK', airportName: 'New York JFK', duration: '2h 57m', verdict: 'normal' },
    // 2h20m at Delhi, same-terminal (T3) international→international (arrive 11:40 → depart 14:00).
    // Enough for the transfer-security queue that made the earlier, shorter version of this
    // connection the tight one.
    { airportCode: 'DEL', airportName: 'Delhi Indira Gandhi Intl', duration: '2h 20m', verdict: 'normal' },
  ],
};

export const RETURN_TO_JAPAN_JOURNEY: Journey = {
  id: 'return-to-japan', label: 'Kathmandu to Tokyo', status: 'booked',
  fromSummary: 'Kathmandu (KTM)', toSummary: 'Tokyo (HND)',
  totalDuration: '10h 50m',
  departDate: '2026-12-18',           // authored from leg ret-1 '11:30pm Fri Dec 18'
  legs: [
    { id: 'ret-1', flightNumber: 'China Southern Airlines 3068',
      fromCode: 'KTM', fromName: 'Kathmandu Tribhuvan Intl', fromTerminal: 'Terminal I',
      toCode: 'CAN', toName: 'Guangzhou Baiyun Intl', toTerminal: 'Terminal 2',
      departLabel: '11:30pm Fri Dec 18', arriveLabel: '5:55am Sat Dec 19',
      duration: '4h 10m', cabin: 'Economy', cabinCode: 'L' },   // no seats given — omit the seats line in UI
    { id: 'ret-2', flightNumber: 'China Southern Airlines 385',
      fromCode: 'CAN', fromName: 'Guangzhou Baiyun Intl', fromTerminal: 'Terminal 2',
      toCode: 'HND', toName: 'Tokyo Haneda', toTerminal: 'Terminal 3',
      departLabel: '8:50am Sat Dec 19', arriveLabel: '1:35pm Sat Dec 19',
      duration: '3h 45m', cabin: 'Economy', cabinCode: 'L' },   // no seats given
  ],
  // 2h55m at Guangzhou is an international→international transfer (immigration/security
  // recheck) — tighter than a long domestic gap despite the clock; not razor-thin → normal.
  layovers: [{ airportCode: 'CAN', airportName: 'Guangzhou Baiyun Intl', duration: '2h 55m', verdict: 'normal' }],
};

export const TOKYO_TO_OSAKA_JOURNEY: Journey = {
  id: 'tokyo-to-osaka', label: 'Tokyo to Osaka', status: 'booked',
  fromSummary: 'Tokyo (HND)', toSummary: 'Osaka (ITM)',
  totalDuration: '1h 10m',
  departDate: '2026-12-19',           // authored from leg dom-1 '4:25pm Sat Dec 19'
  legs: [
    { id: 'dom-1', flightNumber: 'Japan Airlines 127',
      fromCode: 'HND', fromName: 'Tokyo Haneda', fromTerminal: 'Terminal 1',
      toCode: 'ITM', toName: 'Osaka Itami',
      departLabel: '4:25pm Sat Dec 19', arriveLabel: '5:35pm Sat Dec 19',
      duration: '1h 10m', cabin: 'Economy', cabinCode: 'Q' },   // no seats given — omit the seats line in UI
  ],
  layovers: [],
};

export const FLIGHT_HOME_JOURNEY: Journey = {
  id: 'flight-home', label: 'Flight home — Tokyo to Syracuse', status: 'booked',
  fromSummary: 'Tokyo (HND)', toSummary: 'Syracuse (SYR)',
  totalDuration: '19h 23m',           // verbatim from the booking source — render as-is, do NOT recompute
  departDate: '2027-01-09',           // authored from leg home-1 '5:35pm Sat Jan 9'
  legs: [
    { id: 'home-1', flightNumber: 'Delta 274',
      fromCode: 'HND', fromName: 'Tokyo Haneda', fromTerminal: 'Terminal 3',
      toCode: 'DTW', toName: 'Detroit Metropolitan Wayne County', toTerminal: 'Terminal M',
      departLabel: '5:35pm Sat Jan 9', arriveLabel: '3:35pm Sat Jan 9',
      duration: '12h', cabin: 'Economy', cabinCode: 'E' },   // no seats given — omit the seats line in UI
    { id: 'home-2', flightNumber: 'Delta 1689',
      fromCode: 'DTW', fromName: 'Detroit Metropolitan Wayne County', fromTerminal: 'Terminal M',
      toCode: 'SYR', toName: 'Syracuse Hancock Intl',
      departLabel: '9:35pm Sat Jan 9', arriveLabel: '10:58pm Sat Jan 9',
      duration: '1h 23m', cabin: 'Economy', cabinCode: 'E' },   // no seats given
  ],
  // 6h at Detroit — a domestic connection AFTER US customs clearance; ample. → relaxed.
  layovers: [{ airportCode: 'DTW', airportName: 'Detroit Metropolitan Wayne County', duration: '6h', verdict: 'relaxed' }],
};

export const NEPAL_STAY: Stay = {
  id: 'nepal-hotel', name: 'Thamel Garden Hotel', stars: 3,
  address: 'Thamel, Kathmandu',
  area: 'Thamel — beside Garden of Dreams',
  city: 'Kathmandu', country: 'nepal', status: 'booked',
};

export const OSAKA_STAY: Stay = {
  id: 'osaka-hotel', name: 'HOTEL THE Grandee Shinsaibashi Namba', stars: null,
  address: 'Shinsaibashi, Osaka',
  city: 'Osaka', country: 'japan', status: 'booked',
  checkIn: '3:00pm Sat Dec 19',
  checkOut: '11:00am Thu Dec 24',
  note: '5 nights · 3 adults · 3 rooms',
};

export const KYOTO_STAY: Stay = {
  id: 'kyoto-hotel', name: 'Hotel Forza Kyoto Shijo Kawaramachi', stars: null,
  address: 'Kawaramachi, Kyoto',
  city: 'Kyoto', country: 'japan', status: 'booked',
  checkIn: '2:00pm Thu Dec 24',
  checkOut: '11:00am Sun Dec 27',
  note: '3 nights · 3 adults · 3 rooms',
};

export const TOKYO_STAY: Stay = {
  id: 'tokyo-hotel', name: 'APA Hotel Shinjuku Kabukicho Chuo', stars: null,
  address: 'Kabukicho, Shinjuku, Tokyo',
  city: 'Tokyo', country: 'japan', status: 'booked',
  checkIn: '3:00pm Sun Dec 27',
  checkOut: '10:00am Sat Jan 9',
  note: '13 nights · 3 adults · 3 rooms',
};

// Convenience ordered list for the section to map over.
export const JOURNEYS: Journey[] = [OUTBOUND_JOURNEY, RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY, FLIGHT_HOME_JOURNEY];

// Ordered stays (chronological) for the section to map over.
export const BOOKED_STAYS: Stay[] = [NEPAL_STAY, OSAKA_STAY, KYOTO_STAY, TOKYO_STAY];
