import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { domainApi, keywordApi } from '../../api/endpoints';
import CountrySelect from '../../components/CountrySelect';
import KeywordTable from '../../components/KeywordTable';
import KeywordTrendModal from '../../components/KeywordTrendModal';
import OpportunityLists from '../../components/OpportunityLists';
import PositionDistribution, { BUCKETS } from '../../components/charts/PositionDistribution';
import { EmptyState, Skeleton } from '../../components/ui/Feedback';
import { DAY_OPTIONS, fmt } from '../../utils/format';

export default function Keywords() {
  const [days, setDays] = useState(28);
  const [domainId, setDomainId] = useState('');
  const [country, setCountry] = useState('');
  const [bucket, setBucket] = useState('');
  const [view, setView] = useState('all');
  const [selected, setSelected] = useState(null);

  const domains = useQuery({ queryKey: ['domains'], queryFn: domainApi.list });
  const connected = (domains.data?.domains || []).filter((d) => d.gsc_property);
  const scope = { days, ...(domainId && { domainId }), ...(country && { country }) };
  const overview = useQuery({ queryKey: ['keywords-overview', scope], queryFn: () => keywordApi.overview(scope) });
  const positions = overview.data?.positions;
  const total = positions ? BUCKETS.reduce((a, b) => a + positions[b.key], 0) : 0;

  if (domains.isSuccess && !connected.length) {
    return (
      <div className="stack">
        <div className="page-head"><div><h1>Organik Anahtar Kelimeler</h1></div></div>
        <div className="card">
          <EmptyState icon={KeyRound} title="Search Console’a bağlı alan adı yok" action={<Link to="/domains" className="btn btn-primary">Alan adlarına git</Link>}>
            Anahtar kelime sıralamalarını görmek için en az bir alan adını Search Console mülküne bağlayın.
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Organik Anahtar Kelimeler</h1>
          <p>Tüm alan adlarınızın sıralandığı kelimeler, pozisyon değişimleri ve fırsatlar.</p>
        </div>
        <div className="row">
          <select className="select select-sm" style={{ width: 200 }} value={domainId} onChange={(e) => setDomainId(e.target.value)} aria-label="Alan adı">
            <option value="">Tüm alan adları</option>
            {connected.map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}
          </select>
          <CountrySelect countries={overview.data?.countries} value={country} onChange={setCountry} />
          <select className="select select-sm" style={{ width: 150 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Tarih aralığı">
            {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-4">
        {[
          ['Toplam kelime', total],
          ['İlk 3', positions?.top3],
          ['İlk sayfa (1–10)', positions ? positions.top3 + positions.top10 : null],
          ['2. sayfa (11–20)', positions?.top20],
        ].map(([label, value]) => (
          <div key={label} className="card stat">
            <span className="stat-label">{label}</span>
            {overview.isLoading ? <Skeleton height={34} width={90} /> : <span className="stat-value num">{fmt.num(value)}</span>}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div><h3>Pozisyon dağılımı</h3><p>Bir çubuğa tıklayarak listeyi filtreleyin</p></div></div>
        <div className="card-body">
          {overview.isLoading ? <Skeleton height={220} /> : <PositionDistribution data={positions} onSelect={(b) => { setBucket(b); setView('all'); }} />}
        </div>
      </div>

      <div className="segmented" style={{ alignSelf: 'flex-start' }}>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>Tüm kelimeler</button>
        <button className={view === 'opp' ? 'active' : ''} onClick={() => setView('opp')}>Fırsatlar & Hareketler</button>
      </div>

      {view === 'all' ? (
        <KeywordTable
          queryKey={['keywords-global', domainId]}
          fetcher={(params) => keywordApi.list({ ...params, ...(domainId && { domainId }) })}
          days={days}
          country={country}
          showDomain={!domainId}
          bucket={bucket}
          onBucket={setBucket}
          onRowClick={(r) => setSelected({ domainId: r.domain_id, keyword: r.key })}
        />
      ) : overview.isLoading ? (
        <Skeleton height={300} />
      ) : (
        <OpportunityLists data={overview.data?.opportunities} showDomain={!domainId} />
      )}

      {selected && <KeywordTrendModal {...selected} days={days} onClose={() => setSelected(null)} />}
    </div>
  );
}
