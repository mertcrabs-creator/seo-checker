import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CircleHelp, Combine, Flame, Layers, Lightbulb, RefreshCw, Search, Sparkles, Swords } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton } from '../../../components/ui/Feedback';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { IntentBadge, Tip } from './common';
import { briefLink } from './SerpView';

export const IDEA_TYPES = {
  pillar: { label: 'Ana sayfa (pillar)', icon: Layers, cls: 'badge-good', tip: 'Tek bir kapsamlı sayfayla kazanılabilecek konu kümesi' },
  question: { label: 'Soru içeriği', icon: CircleHelp, cls: 'badge-notice', tip: 'Kullanıcıların sorduğu ama sitede doğrudan yanıtı olmayan sorular' },
  trending: { label: 'Yükselen arama', icon: Flame, cls: 'badge-warning', tip: 'Talebi hızla artan aramalar' },
  competitor_gap: { label: 'Rakip konusu', icon: Swords, cls: 'badge-critical', tip: 'Rakiplerin özel sayfa açtığı, sizde olmayan konular' },
  paa: { label: 'Google soruları', icon: Sparkles, cls: 'badge-notice', tip: 'Google “Diğer sorular” kutusundan' },
  consolidate: { label: 'Birleştir', icon: Combine, cls: 'badge-warning', tip: 'Aynı konuda yarışan sayfalarınız' },
  refresh: { label: 'Güncelle', icon: RefreshCw, cls: 'badge-neutral', tip: 'Trafiği eriyen mevcut sayfalar' },
};

function Metrics({ i }) {
  return (
    <div className="row" style={{ gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
      {i.impressions != null && <span className="muted">{fmt.num(i.impressions)} gösterim</span>}
      {i.position != null && <span className="row" style={{ gap: 4 }}><span className="muted">sıra</span> <PositionPill value={i.position} /></span>}
      {i.growth != null && <span className="badge badge-warning">+%{fmt.num(i.growth)}</span>}
      {i.competitors != null && <span className="muted">{i.competitors} rakipte var</span>}
      {i.potential ? <span className="badge badge-good">+{fmt.num(i.potential)} tık potansiyel</span> : null}
    </div>
  );
}

/** İçerik fikirleri: çalışılan kelimeler, kümeler, rakipler ve Google sorularından öncelikli içerik planı. */
export default function IdeasView({ domain }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['insights', domain.id, 'ideas'], queryFn: () => insightApi.ideas(domain.id), staleTime: 10 * 60_000 });
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    return (data?.ideas || []).filter((i) => (!type || i.type === type) && (!q || i.keyword.toLocaleLowerCase('tr').includes(q)));
  }, [data, type, search]);

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (!data.ideas.length) {
    return <div className="card"><EmptyState icon={Lightbulb} title="Henüz fikir üretilecek veri yok">Search Console bağlantısı, site taraması veya rakip eklemek fikir kaynaklarını açar.</EmptyState></div>;
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="row" style={{ gap: 8 }}><Lightbulb size={17} /> İçerik fikirleri</h3>
            <p>
              Kaynaklar: {[data.sources.gsc && 'Search Console sorguları', data.sources.clusters === 'gsc' ? 'kelime kümeleri' : 'taramadaki hedef kelimeler', 'rakip boşlukları', data.sources.paa && 'Google “Diğer sorular”', data.sources.gsc && 'içerik erimesi'].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <Tip>
          Fikirler tahmini potansiyele göre sıralı (gösterim × ilk 3’e çıkınca beklenen tıklama oranı). “Brief oluştur” ile Google’ın ilk 10’undaki sayfalar
          analiz edilip başlıklar, terimler, sorular ve hedef uzunluk içeren yazar planı hazırlanır.
        </Tip>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <div className="input-icon">
            <Search size={16} />
            <input className="input input-sm" placeholder="Fikir ara" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Fikir ara" />
          </div>
          <div className="segmented" role="tablist" aria-label="Fikir türü" style={{ flexWrap: 'wrap' }}>
            <button className={!type ? 'active' : ''} onClick={() => setType('')}>Tümü ({data.ideas.length})</button>
            {Object.entries(IDEA_TYPES).filter(([k]) => data.counts[k]).map(([k, t]) => (
              <button key={k} className={type === k ? 'active' : ''} onClick={() => setType(k)} title={t.tip}>{t.label} ({data.counts[k]})</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          {rows.length ? (
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Fikir</th><th>Neden</th><th className="r" /></tr></thead>
              <tbody>
                {rows.map((i, idx) => {
                  const t = IDEA_TYPES[i.type];
                  const k = `${i.type}|${i.keyword}|${idx}`;
                  const isOpen = open === k;
                  const expandable = i.supporting?.length || i.examples?.length || i.page;
                  return (
                    <Fragment key={k}>
                      <tr className={expandable ? 'clickable' : ''} onClick={expandable ? () => setOpen(isOpen ? null : k) : undefined} aria-expanded={expandable ? isOpen : undefined}>
                        <td>{expandable ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}</td>
                        <td style={{ maxWidth: 420 }}>
                          <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                            <span className={`badge ${t.cls}`}><t.icon size={12} /> {t.label}</span>
                            {i.intent && <IntentBadge intent={i.intent} />}
                          </div>
                          <div className="cell-main">{i.type === 'refresh' && i.page ? <a href={safeHref(i.page)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{i.keyword}</a> : i.keyword}</div>
                          {i.title && <div className="cell-sub" title="Önerilen başlık">✎ {i.title}</div>}
                        </td>
                        <td style={{ maxWidth: 460 }}>
                          <div className="text-2" style={{ fontSize: 13, marginBottom: 4 }}>{i.reason}</div>
                          <Metrics i={i} />
                        </td>
                        <td className="r">
                          <Link className="btn btn-secondary btn-sm" to={briefLink(domain.id, i.type === 'refresh' ? (i.keyword.startsWith('http') ? shortUrl(i.keyword).replace(/[/-]+/g, ' ').trim() : i.keyword) : i.keyword)} onClick={(e) => e.stopPropagation()}>
                            <Sparkles size={14} /> Brief
                          </Link>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} style={{ background: 'var(--surface-2)' }}>
                            <div style={{ display: 'grid', gap: 10, padding: '4px 4px 8px' }}>
                              {i.supporting?.length > 0 && (
                                <div><div className="hint" style={{ marginBottom: 4 }}>Aynı sayfada kapsanması gereken sorgular</div><div className="row" style={{ gap: 4 }}>{i.supporting.map((s) => <span key={s} className="badge badge-neutral">{s}</span>)}</div></div>
                              )}
                              {i.examples?.length > 0 && (
                                <div className="url-list" style={{ background: 'var(--surface)' }}>
                                  {i.examples.map((e) => <div key={e.url}><a href={safeHref(e.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={e.url}>{e.title || e.url}</a><span className="muted num">{fmt.num(e.words)} kelime</span></div>)}
                                </div>
                              )}
                              {i.page && i.type !== 'refresh' && <div className="hint">Şu an sıralanan sayfanız: <a href={safeHref(i.page)} target="_blank" rel="noopener noreferrer">{shortUrl(i.page)}</a></div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState icon={Lightbulb} title="Bu filtrede fikir yok" />}
        </div>
      </div>
    </div>
  );
}
