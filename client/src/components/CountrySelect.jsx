import { countryName, fmt } from '../utils/format';

/** Search Console ülke filtresi (alpha-3 kodlar, gösterime göre sıralı). */
export default function CountrySelect({ countries = [], value, onChange, width = 220 }) {
  return (
    <select className="select select-sm" style={{ width }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Ülke">
      <option value="">Tüm ülkeler</option>
      {countries.map((c) => (
        <option key={c.key} value={c.key}>{countryName(c.key)} · {fmt.compact(c.impressions)} gösterim</option>
      ))}
    </select>
  );
}
