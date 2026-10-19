import { useQuery } from '@tanstack/react-query';
import { Boxes, ChevronDown, ChevronRight, Layers, Search, Sparkles, Target, TrendingUp } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { briefLink } from './SerpView';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { NoAuditState } from '../site/shared';
import { INTENT_LABELS, IntentBadge, Tiles, Tip } from './common';

const SORTS = { impressions: 'Gösterim', potential: 'Potansiyel', queries: 'Sorgu sayısı' };

function ClusterDetail({ c, gsc, domainId }) {
  return (
    <div className="grid grid-2" style={{ padding: '6px 4px 10px', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div><Link className="btn btn-secondary btn-sm" to={briefLink(domainId, c.name)}><Sparkles size={14} /> Bu küme için içerik brief’i</Link></div>
        {c.cannibalized && (
          <Alert type="warning">
            Bu kümede {c.pages.filter((p) => p.share >= 0.2).length} sayfa gösterim paylaşıyor (Google hangisini sıralayacağına karar veremiyor).
            En güçlü sayfayı ana sayfa yapın; diğerlerini farklı alt konulara odaklayın, birleştirin veya ana sayfaya bağlantı verin.
          </Alert>
        )}
        {gsc && c.striking >= 3 && (
          <div className="issue-fix"><TrendingUp size={16} /> <div>Kümede {c.striking} sorgu 4–20. sırada. Konuyu tüm alt sorgularıyla kapsayan tek bir ana (pillar) sayfa ve ona bağlanan destek içerikleri hızlı kazanım sağlar.</div></div>
        )}
        <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <table className="table">
            <thead><tr><th>Sayfa</th><th>{gsc ? 'Gösterim payı' : 'İçerik payı'}</th>{gsc && <th className="r">Tık</th>}</tr></thead>
            <tbody>
              {c.pages.map((p) => (
                <tr key={p.page}>
                  <td className="truncate" style={{ maxWidth: 240 }}><a href={safeHref(p.page)} target="_blank" rel="noopener noreferrer" title={p.page}>{shortUrl(p.page)}</a></td>
                  <td><div className="bar-cell"><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round(p.share * 100)}%` }} /></div><span className="num" style={{ fontSize: 12 }}>%{Math.round(p.share * 100)}</span></div></td>
                  {gsc && <td className="r">{fmt.num(p.clicks)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', maxHeight: 340, overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th>Sorgu</th>{gsc && <th className="r">Poz.</th>}<th className="r">{gsc ? 'Gösterim' : 'Puan'}</th><th className="r">Niyet</th></tr></thead>
          <tbody>
            {c.members.map((m) => (
              <tr key={m.query}>
                <td className="truncate" style={{ maxWidth: 240 }}>{m.query}</td>
                {gsc && <td className="r"><PositionPill value={m.position} /></td>}
                <td className="r">{fmt.num(m.impressions)}</td>
                <td className="r"><IntentBadge intent={m.intent} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Anahtar kelime kümeleri: aynı niyetteki sorgular (kök benzerliği + aynı sayfada sıralanma), Google tarafı yamyamlık ve potansiyel. */
export default function ClustersView({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'clusters'], queryFn: () => insightApi.clusters(domain.id) });
  const [search, setSearch] = useState('');
  const [intent, setIntent] = useState('');
  const [onlyCannibal, setOnlyCannibal] = useState(false);
  const [sort, setSort] = useState('impressions');
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    return (data?.clusters || [])
      .filter((c) => (!intent || c.intent === intent) && (!onlyCannibal || c.cannibalized) && (!q || c.name.includes(q) || c.members.some((m) => m.query.includes(q))))
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [data, search, intent, onlyCannibal, sort]);

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (data.empty) return data.source === 'site' ? <NoAuditState domain={domain} /> : <div className="card"><EmptyState icon={Boxes} title="Kümelenecek veri yok" /></div>;

  const gsc = data.source === 'gsc';
  const s = data.summary;
  return (
    <div className="stack">
      <Tiles items={[
        { label: 'Küme', value: fmt.num(s.clusters), icon: Boxes, foot: `${fmt.num(s.items)} ${gsc ? 'sorgudan' : 'kelimeden'}` },
        { label: 'Kümelenen', value: fmt.pct(s.items ? s.clustered / s.items : 0), icon: Layers, foot: `${fmt.num(data.unclustered)} tekil ${gsc ? 'sorgu' : 'kelime'}` },
        { label: 'Yamyamlık', value: fmt.num(s.cannibalized), icon: Target, tone: s.cannibalized ? 'warning' : undefined, foot: 'birden çok sayfanın yarıştığı küme' },
        { label: 'Potansiyel', value: gsc ? `+${fmt.num(s.potential)}` : '—', icon: TrendingUp, tone: 'good', foot: gsc ? 'tık / 28 gün (4–20. sıradakiler ilk 3’e çıkarsa)' : 'Search Console gerekli' },
      ]} />
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="row" style={{ gap: 8 }}><Boxes size={17} /> Konu kümeleri</h3>
            <p>{gsc ? 'Search Console sorguları (son 28 gün)' : 'Search Console bağlı değil: taramadaki hedef kelimeler (ağırlık = içerik puanı)'}</p>
          </div>
        </div>
        <Tip>
          Aynı kökleri paylaşan ve/veya Google’ın aynı sayfayı gösterdiği sorgular tek niyet sayılır. Her küme için tek bir güçlü sayfa hedefleyin;
          kümenin tüm alt sorgularını o sayfada (başlıklar, SSS) işlemek tek tek kelime optimize etmekten daha etkilidir.
        </Tip>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <div className="input-icon">
            <Search size={16} />
            <input className="input input-sm" placeholder="Küme veya sorgu ara" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Küme ara" />
          </div>
          <select className="select select-sm" style={{ width: 170 }} value={intent} onChange={(e) => setIntent(e.target.value)} aria-label="Niyet">
            <option value="">Tüm niyetler</option>
            {Object.entries(INTENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="select select-sm" style={{ width: 160 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sıralama">
            {Object.entries(SORTS).filter(([k]) => gsc || k !== 'potential').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="row muted" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={onlyCannibal} onChange={(e) => setOnlyCannibal(e.target.checked)} /> Sadece yamyamlık
          </label>
        </div>
        <div className="table-wrap">
          {rows.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} /><th>Küme</th><th className="r">Sorgu</th><th className="r">{gsc ? 'Gösterim' : 'Puan'}</th>
                  {gsc && <><th className="r">Tık</th><th className="r">Poz.</th><th className="r">İlk 10</th><th className="r">Potansiyel</th></>}
                  <th>Niyet</th><th>Ana sayfa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const isOpen = open === c.name;
                  return (
                    <Fragment key={c.name}>
                      <tr className="clickable" onClick={() => setOpen(isOpen ? null : c.name)} aria-expanded={isOpen}>
                        <td>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                        <td>
                          <div className="cell-main truncate" style={{ maxWidth: 260 }}>{c.name}</div>
                          <div className="row" style={{ gap: 4, marginTop: 2 }}>
                            {c.cannibalized && <span className="badge badge-warning">Yamyamlık</span>}
                            {c.brand && <span className="badge badge-neutral">Marka</span>}
                          </div>
                        </td>
                        <td className="r">{fmt.num(c.queries)}</td>
                        <td className="r">{fmt.num(c.impressions)}</td>
                        {gsc && (
                          <>
                            <td className="r">{fmt.num(c.clicks)}</td>
                            <td className="r"><PositionPill value={c.position} /></td>
                            <td className="r num">{c.top10}/{c.queries}</td>
                            <td className="r">{c.potential ? <span className="badge badge-good">+{fmt.num(c.potential)}</span> : <span className="muted">—</span>}</td>
                          </>
                        )}
                        <td><IntentBadge intent={c.intent} /></td>
                        <td className="truncate" style={{ maxWidth: 200 }}>{c.mainPage ? <a href={safeHref(c.mainPage)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={c.mainPage}>{shortUrl(c.mainPage)}</a> : '—'}</td>
                      </tr>
                      {isOpen && <tr><td colSpan={gsc ? 10 : 6} style={{ background: 'var(--surface-2)' }}><ClusterDetail c={c} gsc={gsc} domainId={domain.id} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState icon={Boxes} title="Küme bulunamadı" />}
        </div>
      </div>
    </div>
  );
}
