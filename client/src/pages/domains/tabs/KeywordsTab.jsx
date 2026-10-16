import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { domainApi } from '../../../api/endpoints';
import CountrySelect from '../../../components/CountrySelect';
import KeywordTable from '../../../components/KeywordTable';
import KeywordTrendModal from '../../../components/KeywordTrendModal';
import PositionDistribution, { BUCKETS } from '../../../components/charts/PositionDistribution';
import { Skeleton } from '../../../components/ui/Feedback';
import { countryName, fmt } from '../../../utils/format';

export default function KeywordsTab({ domain, days }) {
  const id = domain.id;
  const [bucket, setBucket] = useState('');
  const [country, setCountry] = useState('');
  const [selected, setSelected] = useState(null);
  const breakdown = useQuery({
    queryKey: ['gsc', id, 'breakdown', days, country],
    queryFn: () => domainApi.breakdown(id, { days, ...(country && { country }) }),
  });
  // Ülke listesi filtreden bağımsız (tüm ülkeler) kalsın
  const all = useQuery({ queryKey: ['gsc', id, 'breakdown', days, ''], queryFn: () => domainApi.breakdown(id, { days }), enabled: Boolean(country) });
  const countries = (country ? all.data : breakdown.data)?.countries || [];
  const positions = breakdown.data?.positions;
  const total = positions ? BUCKETS.reduce((a, b) => a + positions[b.key], 0) : 0;
  const where = country ? countryName(country) : 'Tüm ülkeler';

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 15 }}>Ülke bazlı sıralamalar</h3>
          <p className="text-2" style={{ fontSize: 13 }}>Bir ülke seçin; pozisyonlar, dağılım ve tablo o ülkedeki Google sonuçlarına göre hesaplanır.</p>
        </div>
        <CountrySelect countries={countries} value={country} onChange={setCountry} width={260} />
      </div>

      <div className="grid grid-2-1">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Pozisyon dağılımı · {where}</h3>
              <p>Bir çubuğa tıklayarak tabloyu filtreleyin</p>
            </div>
          </div>
          <div className="card-body">
            {breakdown.isLoading ? <Skeleton height={220} /> : <PositionDistribution data={positions} onSelect={setBucket} />}
          </div>
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>Özet · {where}</h3>
          <div className="metric-tile"><small>Sıralanan anahtar kelime</small><strong className="num">{fmt.num(total)}</strong></div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="metric-tile"><small>İlk 3</small><strong className="num">{fmt.num(positions?.top3)}</strong></div>
            <div className="metric-tile"><small>İlk sayfa (1–10)</small><strong className="num">{fmt.num(positions ? positions.top3 + positions.top10 : null)}</strong></div>
          </div>
          <div className="metric-tile">
            <small>2. sayfa (11–20) — en hızlı kazanılacak trafik</small>
            <strong className="num">{fmt.num(positions?.top20)}</strong>
          </div>
        </div>
      </div>

      <KeywordTable
        queryKey={['gsc', id, 'keywords']}
        fetcher={(params) => domainApi.keywords(id, params)}
        days={days}
        country={country}
        bucket={bucket}
        onBucket={setBucket}
        onRowClick={(r) => setSelected(r.key)}
      />

      {selected && <KeywordTrendModal domainId={id} keyword={selected} days={days} onClose={() => setSelected(null)} />}
    </div>
  );
}
