import { cityLegend, TRANSIT_COLOR } from '@/lib/city-palette';

const swatch = 'inline-block h-2.5 w-2.5 shrink-0 align-middle';

export default function CityLegend() {
  const { legend, hasSatellite, hasTransit } = cityLegend();
  if (legend.length === 0) return null;
  return (
    <ul
      aria-label="Calendar colours"
      data-testid="city-legend"
      className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[color:hsl(var(--border))] pt-3 text-t-sm text-ink-mid"
    >
      {legend.map((e) => (
        <li key={e.city} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`${swatch} rounded-full`} style={{ background: e.color }} />
          {e.city}
        </li>
      ))}
      {hasSatellite && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rotate-45 bg-ink-mid" />
          Day trip
        </li>
      )}
      {hasTransit && (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`${swatch} border`}
            style={{
              borderColor: TRANSIT_COLOR,
              background: `linear-gradient(135deg, transparent 0 46%, ${TRANSIT_COLOR} 46% 54%, transparent 54%)`,
            }}
          />
          Travel day
        </li>
      )}
    </ul>
  );
}
