import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronRight, FileText, HelpCircle, MapPin, Megaphone, Plus, RefreshCw, Search, Sparkles, Star, Trash2, Video } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { domainApi, insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { countryName, fmt, safeHref } from '../../../utils/format';
import { Tiles, Tip } from './common';

const FALLBACK_COUNTRIES = ['TUR', 'USA', 'GBR', 'DEU', 'FRA', 'NLD', 'ITA', 'ESP', 'AUS', 'CAN', 'IRL', 'BEL', 'AUT', 'CHE', 'SAU', 'ARE', 'RUS', 'AZE'].map((key) => ({ key }));
export const briefLink = (domainId, keyword) => `/domains/${domainId}/insights?view=briefs&keyword=${encodeURIComponent(keyword)}`;

function FeatureIcons({ f }) {
  if (!f) return <span className="muted">—</span>;
  const items = [
    f.peopleAlsoAsk > 0 && [HelpCircle, `Diğer sorular (${f.peopleAlsoAsk})`],
    f.localPack && [MapPin, 'Harita / yerel sonuçlar'],
    f.video && [Video, 'Video sonuçları'],
    f.ads > 0 && [Megaphone, `${f.ads} reklam`],
    f.knowledgeGraph && [Star, 'Bilgi paneli'],
    f.forums && [FileText, 'Forum / tartışmalar'],
  ].filter(Boolean);
  return <span className="row" style={{ gap: 6 }}>{items.map(([Icon, label]) => <span key={label} title={label} aria-label={label} className="muted"><Icon size={15} /></span>)}</span>;
}

function AiBadge({ f }) {
  if (!f) return <span className="muted">—</span>;
  if (!f.aiOverview) return <span className="badge badge-neutral">Yok</span>;
  return f.aiOverview.cited ? <span className="badge badge-good">Kaynak sizsiniz</span> : <span className="badge badge-warning">Var, siz yoksunuz</span>;
}

function AddForm({ domain, onAdded }) {
  const toast = useToast();
  const [kw, setKw] = useState('');
  const [country, setCountry] = useState('');
  const [device, setDevice] = useState('mobile');
  const countries = useQuery({ queryKey: ['gsc', domain.id, 'breakdown', 28], queryFn: () => domainApi.breakdown(domain.id, { days: 28 }), enabled: Boolean(domain.gsc_property) });
  const list = countries.data?.countries?.length ? countries.data.countries : FALLBACK_COUNTRIES;
  const selected = country || list[0]?.key || 'TUR';
  const suggestions = useQuery({ queryKey: ['insights', domain.id, 'serp-suggestions'], queryFn: () => insightApi.serpSuggestions(domain.id), enabled: Boolean(domain.gsc_property) });
  const add = useMutation({
    mutationFn: (items) => insightApi.addSerpKeywords(domain.id, items),
    onSuccess: (r) => {
      toast.success(r.skipped ? `${r.added} kelime eklendi, ${r.skipped} kelime limit nedeniyle eklenmedi` : `${r.added} kelime eklendi`);
      setKw('');
      onAdded();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="card">
      <div className="card-head"><h3>Kelime ekle</h3></div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); if (kw.trim()) add.mutate([{ keyword: kw.trim(), country: selected, device }]); }}>
        <input className="input input-sm" style={{ maxWidth: 300 }} placeholder="Takip edilecek kelime" value={kw} onChange={(e) => setKw(e.target.value)} aria-label="Kelime" />
        <select className="select select-sm" style={{ width: 200 }} value={selected} onChange={(e) => setCountry(e.target.value)} aria-label="Ülke">
          {list.map((c) => <option key={c.key} value={c.key}>{countryName(c.key)}</option>)}
        </select>
        <div className="segmented" role="tablist" aria-label="Cihaz">
          {[['mobile', 'Mobil'], ['desktop', 'Masaüstü']].map(([k, l]) => <button type="button" key={k} className={device === k ? 'active' : ''} onClick={() => setDevice(k)}>{l}</button>)}
        </div>
        <button className="btn btn-primary btn-sm" disabled={!kw.trim() || add.isPending}>{add.isPending ? <Spinner size={14} /> : <Plus size={15} />} Ekle</button>
      </form>
      {suggestions.data?.suggestions?.length > 0 && (
        <div style={{ padding: '0 20px 16px' }}>
          <div className="hint" style={{ marginBottom: 6 }}>Öneriler (Search Console’da ilk 20’de, en çok gösterim alan marka dışı kelimeler):</div>
          <div className="row" style={{ gap: 6 }}>
            {suggestions.data.suggestions.slice(0, 16).map((s) => (
              <button key={`${s.query}|${s.country}`} type="button" className="badge badge-neutral" style={{ cursor: 'pointer', border: 0 }} disabled={add.isPending}
                onClick={() => add.mutate([{ keyword: s.query, country: s.country, device }])} title={`${countryName(s.country)} · ${fmt.num(s.impressions)} gösterim · ${s.position}. sıra`}>
                <Plus size={11} /> {s.query} <span className="muted">· {s.country}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** SERP özellikleri ve AI Overview izleme: önemli kelimelerde Google sonuç sayfasında ne var, kim kazanıyor. */
export default function SerpView({ domain }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['insights', domain.id, 'serp'];
  const { data, isLoading, isError, error } = useQuery({ queryKey: key, queryFn: () => insightApi.serp(domain.id), refetchInterval: (q) => (q.state.data?.running ? 5000 : false) });
  const [open, setOpen] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['insights', domain.id] });
  const check = useMutation({ mutationFn: () => insightApi.checkSerp(domain.id), onSuccess: () => { toast.success('Kontrol başladı'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id) => insightApi.removeSerpKeyword(domain.id, id), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <Alert type="error">{errorMessage(error)}</Alert>;
  if (!data.enabled) {
    return (
      <div className="card">
        <EmptyState icon={Search} title="SerpApi anahtarı gerekli">
          Google sonuç sayfasını (AI Overview, öne çıkan snippet, “Diğer sorular”, harita, reklam) okumak için sunucu <code>.env</code> dosyasına
          <code> SERPAPI_KEY</code> ekleyin. Ücretsiz plan ayda 250 arama verir; kelime başına haftada 1 arama harcanır.
        </EmptyState>
      </div>
    );
  }
  const s = data.summary;
  const running = data.running || check.isPending;
  return (
    <div className="stack">
      <Tiles items={[
        { label: 'AI Overview çıkan', value: `${s.aiOverview}/${s.checked}`, icon: Bot, tone: s.aiOverview ? 'warning' : undefined, foot: `${s.aiCited} kelimede kaynak sizsiniz` },
        { label: 'Öne çıkan snippet', value: `${s.snippet}/${s.checked}`, icon: Star, foot: `${s.snippetOwned} tanesi sizin` },
        { label: '“Diğer sorular” kutusu', value: `${s.paa}/${s.checked}`, icon: HelpCircle, foot: `${fmt.num(data.questions.length)} farklı soru toplandı` },
        { label: 'SerpApi kalan hak', value: data.quota === null ? '—' : fmt.num(data.quota), icon: Search, foot: `aylık tahmini kullanım ~${data.monthlyEstimate} arama` },
      ]} />

      <AddForm domain={domain} onAdded={refresh} />

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Takip edilen kelimeler <span className="muted">({s.tracked}/{data.limit})</span></h3>
            <p>Her kelime {data.intervalDays} günde bir otomatik kontrol edilir. Kota rezervin altına düşerse kontrol durur.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => check.mutate()} disabled={running || !s.tracked}>
            <RefreshCw size={15} className={running ? 'spin' : ''} /> {running ? 'Kontrol ediliyor' : 'Vadesi gelenleri kontrol et'}
          </button>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {data.rows.length ? (
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Kelime</th><th className="r">Sıranız</th><th>AI Overview</th><th>Snippet</th><th>Diğer özellikler</th><th className="r">Kontrol</th><th /></tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const isOpen = open === r.id;
                  const f = r.features;
                  return (
                    <Fragment key={r.id}>
                      <tr className="clickable" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                        <td>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                        <td><div className="cell-main">{r.keyword}</div><div className="cell-sub">{countryName(r.country)} · {r.device === 'mobile' ? 'Mobil' : 'Masaüstü'}{r.impressions ? ` · ${fmt.num(r.impressions)} gösterim` : ''}</div></td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          {f ? (r.position ? <PositionPill value={r.position} /> : <span className="badge badge-neutral">10+</span>) : <span className="muted">bekliyor</span>}
                          {r.prevPosition && r.position && r.prevPosition !== r.position && <span className={`delta ${r.position < r.prevPosition ? 'delta-up' : 'delta-down'}`} style={{ marginLeft: 6 }}>{r.position < r.prevPosition ? '▲' : '▼'}{Math.abs(r.prevPosition - r.position)}</span>}
                        </td>
                        <td><AiBadge f={f} /></td>
                        <td>{f?.featuredSnippet ? <span className={`badge ${f.featuredSnippet.own ? 'badge-good' : 'badge-warning'}`} title={f.featuredSnippet.title}>{f.featuredSnippet.own ? 'Sizin' : f.featuredSnippet.domain}</span> : <span className="muted">—</span>}</td>
                        <td><FeatureIcons f={f} /></td>
                        <td className="r muted" style={{ whiteSpace: 'nowrap' }}>{r.checkedAt ? fmt.dateTime(r.checkedAt) : '—'}</td>
                        <td className="r"><button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); remove.mutate(r.id); }} aria-label="Takipten çıkar" title="Takipten çıkar"><Trash2 size={14} /></button></td>
                      </tr>
                      {isOpen && f && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--surface-2)' }}>
                            <div className="grid grid-2" style={{ padding: '6px 4px 10px', alignItems: 'start' }}>
                              <div className="url-list" style={{ background: 'var(--surface)' }}>
                                {r.top.map((t) => (
                                  <div key={`${t.position}${t.link}`} style={t.own ? { background: 'var(--good-soft)' } : t.competitor ? { background: 'var(--warning-soft)' } : undefined}>
                                    <span className="truncate" style={{ minWidth: 0 }}><strong className="num">{t.position}.</strong> <a href={safeHref(t.link)} target="_blank" rel="noopener noreferrer" title={t.title}>{t.title || t.domain}</a></span>
                                    <span className="muted" style={{ flex: 'none' }}>{t.own ? 'siz' : t.competitor ? `rakip · ${t.domain}` : t.domain}</span>
                                  </div>
                                ))}
                              </div>
                              <div style={{ display: 'grid', gap: 10 }}>
                                {f.aiOverview && (
                                  <div className="issue-fix" style={{ background: f.aiOverview.cited ? 'var(--good-soft)' : 'var(--warning-soft)' }}>
                                    <Bot size={16} />
                                    <div>
                                      <strong>AI Overview{f.aiOverview.cited ? ' sizi kaynak gösteriyor' : ''}.</strong>{' '}
                                      {f.aiOverview.sources?.length ? <>Kaynaklar: {f.aiOverview.sources.join(', ')}.</> : 'Kaynak listesi alınamadı.'}
                                      {!f.aiOverview.cited && ' Kaynak olmak için sayfanın başında soruyu 2–3 cümlede net yanıtlayın, ardından liste/tablo ve SSS ekleyin.'}
                                    </div>
                                  </div>
                                )}
                                {r.questions.length > 0 && (
                                  <div>
                                    <div className="hint" style={{ marginBottom: 4 }}>Diğer sorular</div>
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{r.questions.map((q) => <li key={q}>{q}</li>)}</ul>
                                  </div>
                                )}
                                {r.related.length > 0 && (
                                  <div>
                                    <div className="hint" style={{ marginBottom: 4 }}>İlgili aramalar</div>
                                    <div className="row" style={{ gap: 4 }}>{r.related.map((q) => <span key={q} className="badge badge-neutral">{q}</span>)}</div>
                                  </div>
                                )}
                                <div><Link className="btn btn-secondary btn-sm" to={briefLink(domain.id, r.keyword)}><Sparkles size={14} /> Bu kelime için içerik brief’i</Link></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState icon={Search} title="Henüz takip edilen kelime yok">Yukarıdan veya önerilerden en önemli 10–20 kelimenizi ekleyin.</EmptyState>}
        </div>
      </div>

      {data.shareOfVoice.length > 0 && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h3>Görünürlük payı (share of voice)</h3></div>
            <Tip>Takip edilen kelimelerde, her sitenin sıralamasına göre topladığı tahmini tıklama payı (kelimenin gösterimiyle ağırlıklı). Yeşil siz, turuncu eklediğiniz rakipler.</Tip>
            <div className="card-body" style={{ display: 'grid', gap: 8 }}>
              {data.shareOfVoice.map((d) => (
                <div key={d.domain} className="bar-cell">
                  <span className="truncate" style={{ width: 190, fontWeight: d.own ? 600 : 400 }} title={d.domain}>{d.domain}{d.own ? ' (siz)' : ''}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(d.share / Math.max(1e-9, data.shareOfVoice[0].share)) * 100}%`, background: d.own ? 'var(--good)' : d.competitor ? 'var(--warning)' : undefined }} /></div>
                  <span className="num" style={{ fontSize: 12, minWidth: 90, textAlign: 'right' }}>%{(d.share * 100).toFixed(1)} · {d.keywords} kelime</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3 className="row" style={{ gap: 8 }}><HelpCircle size={17} /> Kullanıcıların sorduğu sorular</h3><span className="badge badge-neutral">{data.questions.length}</span></div>
            <Tip>Google’ın “Diğer sorular” kutusunda gösterdiği sorular. Bunları sayfalarınızda SSS veya H2 başlığı olarak yanıtlamak hem snippet hem AI Overview şansını artırır.</Tip>
            <div className="url-list" style={{ margin: '10px 20px 20px', maxHeight: 320 }}>
              {data.questions.map((q) => (
                <div key={q.question}>
                  <span>{q.question}</span>
                  <Link to={briefLink(domain.id, q.question)} className="muted" style={{ flex: 'none' }} title="Bu soru için brief">Brief →</Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
