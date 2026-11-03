import { iceStore } from '@/core/storage/gateway';

export const ICE_FIELDS = [
  { key: 'bloodType', label: 'Blood type', max: 20 },
  { key: 'allergies', label: 'Allergies', max: 500, multiline: true },
  { key: 'medications', label: 'Medications and conditions', max: 500, multiline: true },
  { key: 'insurance', label: 'Insurance and policy number', max: 200 },
  { key: 'insurancePhone', label: 'Insurance 24h number', max: 40, tel: true },
  { key: 'contactName', label: 'Home contact name', max: 100 },
  { key: 'contactPhone', label: 'Home contact number', max: 40, tel: true },
  { key: 'hotel', label: 'Hotel name and address (local script)', max: 300, multiline: true },
] as const;

export type IceField = (typeof ICE_FIELDS)[number]['key'];
export type IceCard = Partial<Record<IceField, string>>;

export function sanitizeIce(raw: unknown): IceCard {
  const out: IceCard = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const { key, max } of ICE_FIELDS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== 'string') continue;
    const t = v.trim().slice(0, max);
    if (t) out[key] = t;
  }
  return out;
}

export function loadIce(): IceCard {
  return sanitizeIce(iceStore.get<unknown>({}, sanitizeIce));
}

export function saveIce(card: IceCard): boolean {
  const clean = sanitizeIce(card);
  if (Object.keys(clean).length === 0) {
    iceStore.clear();
    return true;
  }
  return iceStore.set(clean);
}

export function clearIce(): void {
  iceStore.clear();
}
