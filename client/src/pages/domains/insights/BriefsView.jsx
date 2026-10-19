import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Copy, Download, FileText, Link2, ListTree, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { domainApi, insightApi } from '../../../api/endpoints';
import { PositionPill } from '../../../components/ui/DataTable';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { countryName, fmt, safeHref, shortUrl } from '../../../utils/format';
import { IntentBadge, PageLink, Tip } from './common';

const busy = (b) => ['queued', 'running'].includes(b?.status);
const Covered = ({ v }) => (v === null || v === undefined ? <span className="muted">—</span> : v
  ? <span className="badge badge-good" title="Mevcut sayfanızda var"><Check size={12} /></span>
  : <span className="badge badge-critical" title="Mevcut sayfanızda yok"><Minus size={12} /></span>);

/** Brief'i yazara gönderilebilir Markdown'a çevirir. */
function toMarkdown(b) {
  const d = b.data;
  const L = [];
  L.push(`# İçerik Brief’i: ${d.keyword}`, '');
  L.push(`- **Hedef kelime:** ${d.keyword}`, `- **Pazar:** ${countryName(d.country)} (${d.language})`, `- **Arama niyeti:** ${d.intent}`, `- **Hedef uzunluk:** ${d.target.min}–${d.target.max} kelime`, '');
  L.push('## Başlık (title) önerileri', ...d.titleIdeas.map((t) => `- ${t.title}`), '', `**Meta açıklama:** ${d.metaTip}`, '');
  L.push('## Önerilen yapı', ...d.outline.map((o) => `${o.level === 2 ? '-' : '  -'} ${o.level === 2 ? '**H2:**' : 'H3:'} ${o.text}`), '');
  if (d.terms.length) L.push('## Mutlaka geçmesi gereken terimler', d.terms.map((t) => t.term).join(', '), '');
  if (d.questions.length) L.push('## Yanıtlanması gereken sorular', ...d.questions.map((q) => `- ${q.question}`), '');
  if (d.supporting.length) L.push('## Aynı sayfada hedeflenecek sorgular', ...d.supporting.slice(0, 20).map((q) => `- ${q.query}`), '');
  if (d.schema.length) L.push('## Yapısal veri', ...d.schema.map((s) => `- ${s.type}`), '');
  if (d.internalLinks.length) L.push('## İç bağlantılar (bu sayfalardan yeni içeriğe link verin)', ...d.internalLinks.map((l) => `- ${l.url}`), '');
  L.push('## Analiz edilen rakip sayfalar', ...d.competitors.map((c) => `- ${c.url} (${c.words} kelime, ${c.h2} H2)`), '');
  return L.join('\n');
}

function CreateForm({ domain, initialKeyword, onCreated }) {
  const toast = useToast();
  const [keyword, setKeyword] = useState(initialKeyword || '');
  const [country, setCountry] = useState('');
  const [urls, setUrls] = useState('');
  useEffect(() => { if (initialKeyword) setKeyword(initialKeyword); }, [initialKeyword]);
  const countries = useQuery({ queryKey: ['gsc', domain.id, 'breakdown', 28], queryFn: () => domainApi.breakdown(domain.id, { days: 28 }), enabled: Boolean(domain.gsc_property) });
  const create = useMutation({
    mutationFn: () => insightApi.createBrief(domain.id, {
      keyword: keyword.trim(), ...(country && { country }),
      urls: urls.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 8),
    }),
    onSuccess: ({ brief }) => {
      toast.success('Brief hazırlanıyor (yaklaşık 15–40 sn)');
      onCreated(brief.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="card">
      <div className="card-head"><div><h3 className="row" style={{ gap: 8 }}><Sparkles size={17} /> Yeni içerik brief’i</h3><p>Google’ın ilk 10’u (SerpApi varsa) veya rakip sayfaları canlı analiz edilir.</p></div></div>
      <form className="card-body" style={{ display: 'grid', gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (keyword.trim().length >= 2) create.mutate(); }}>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="brief-kw">Hedef kelime</label>
            <input id="brief-kw" className="input input-sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ör. burun estetiği fiyatları" maxLength={200} />
          </div>
          <div className="field" style={{ width: 220 }}>
            <label htmlFor="brief-country">Pazar</label>
            <select id="brief-country" className="select select-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Otomatik (kelimenin dili + en çok gösterim)</option>
              {(countries.data?.countries || []).slice(0, 40).map((c) => <option key={c.key} value={c.key}>{countryName(c.key)}</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" disabled={keyword.trim().length < 2 || create.isPending}>{create.isPending ? <Spinner size={14} /> : <Plus size={15} />} Brief oluştur</button>
        </div>
        <textarea className="input" rows={2} style={{ height: 'auto', padding: 10, fontSize: 13 }} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="İsteğe bağlı: karşılaştırmak istediğiniz rakip URL’leri (boşlukla veya satır satır, en fazla 8)" aria-label="Rakip URL’leri" />
      </form>
    </div>
  );
}

function BriefDetail({ domain, id }) {
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['insights', domain.id, 'brief', id],
    queryFn: () => insightApi.brief(domain.id, id),
    refetchInterval: (q) => (busy(q.state.data?.brief) ? 3000 : false),
  });
  const b = data?.brief;
  if (isLoading) return <Skeleton height={400} />;
  if (!b) return null;
  if (busy(b)) return <div className="card"><EmptyState icon={Sparkles} title={`“${b.keyword}” için brief hazırlanıyor`}><span className="row" style={{ gap: 8, justifyContent: 'center' }}><Spinner size={14} /> Google sonuçları ve rakip sayfalar analiz ediliyor…</span></EmptyState></div>;
  if (b.status === 'failed') return <Alert type="error">Brief hazırlanamadı: {b.error}</Alert>;
  const d = b.data;
  const md = () => toMarkdown(b);
  const copy = () => navigator.clipboard.writeText(md()).then(() => toast.success('Markdown kopyalandı'), () => toast.error('Kopyalanamadı'));
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `brief-${d.keyword.replace(/[^\p{L}\p{N}]+/gu, '-')}.md` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const s = d.stats;

  return (
    <div className="stack">
      <div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 20 }}>{d.keyword}</h2>
            <div className="row muted" style={{ gap: 8, fontSize: 13, marginTop: 4 }}>
              <span>{countryName(d.country)} · {d.language}</span><IntentBadge intent={d.intent} />
              <span className="badge badge-neutral">{d.source === 'serp' ? 'Google ilk 10' : d.source === 'manual' ? 'Verilen URL’ler' : 'Rakip sayfaları'} · {s.pages} sayfa</span>
              <span>{fmt.dateTime(d.generatedAt)}</span>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-secondary btn-sm" onClick={copy}><Copy size={14} /> Markdown kopyala</button>
            <button className="btn btn-secondary btn-sm" onClick={download}><Download size={14} /> İndir</button>
          </div>
        </div>
        {d.notes.map((n) => <Alert key={n} type="info">{n}</Alert>)}
      </div>

      <div className="grid grid-4">
        <div className="card stat"><span className="stat-label">Hedef uzunluk</span><span className="stat-value num">{fmt.num(d.target.min)}–{fmt.num(d.target.max)}</span><span className="stat-foot">kelime · rakip medyanı {fmt.num(s.words.median)}</span></div>
        <div className="card stat"><span className="stat-label">Başlık yapısı</span><span className="stat-value num">{s.h2 ?? '—'} H2</span><span className="stat-foot">rakip medyanı · {s.images ?? 0} görsel</span></div>
        <div className="card stat"><span className="stat-label">SSS kullanan rakip</span><span className="stat-value num">{fmt.pct(s.faqShare)}</span><span className="stat-foot">video: {fmt.pct(s.videoShare)}</span></div>
        <div className="card stat"><span className="stat-label">Son 1 yılda güncellenen</span><span className="stat-value num">{fmt.pct(s.freshShare)}</span><span className="stat-foot">rakip sayfaların</span></div>
      </div>

      {d.existing && !d.existing.error && (
        <div className="card card-pad" style={{ display: 'grid', gap: 8 }}>
          <h3>Mevcut sayfanız</h3>
          <PageLink url={d.existing.url} title={d.existing.title} max={700} />
          <div className="row" style={{ gap: 8 }}>
            {d.existing.position != null && <span className="row" style={{ gap: 4 }}>Sıra <PositionPill value={d.existing.position} /></span>}
            <span className={`badge ${d.existing.words >= d.target.min ? 'badge-good' : 'badge-warning'}`}>{fmt.num(d.existing.words)} kelime</span>
            <span className={`badge ${d.existing.keywordInTitle ? 'badge-good' : 'badge-critical'}`}>Kelime title’da {d.existing.keywordInTitle ? 'var' : 'yok'}</span>
            <span className={`badge ${d.existing.missingHeadings ? 'badge-warning' : 'badge-good'}`}>{d.existing.missingHeadings} eksik başlık</span>
            <span className={`badge ${d.existing.missingTerms ? 'badge-warning' : 'badge-good'}`}>{d.existing.missingTerms} eksik terim</span>
            <span className={`badge ${d.existing.missingQuestions ? 'badge-warning' : 'badge-good'}`}>{d.existing.missingQuestions} yanıtsız soru</span>
          </div>
          <p className="hint">Aşağıdaki tablolarda kırmızı işaretli satırlar mevcut sayfanızda olmayan öğelerdir: önce bunları ekleyin.</p>
        </div>
      )}

      {d.serp?.features?.aiOverview && (
        <Alert type={d.serp.features.aiOverview.cited ? 'success' : 'warning'}>
          <span className="row" style={{ gap: 6 }}><Bot size={15} /> Bu aramada Google AI Overview çıkıyor{d.serp.features.aiOverview.cited ? ' ve sizi kaynak gösteriyor' : ''}.</span>
          {d.serp.features.aiOverview.sources?.length > 0 && <> Kaynaklar: {d.serp.features.aiOverview.sources.join(', ')}.</>} AI Overview’a girmek için girişte soruyu 2–3 cümlede yanıtlayın; ardından liste, tablo ve SSS kullanın.
        </Alert>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Title önerileri</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 8 }}>
            {d.titleIdeas.map((t) => (
              <div key={t.title} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span>{t.title}</span>
                <span className={`badge ${t.length > 60 ? 'badge-warning' : 'badge-neutral'}`}>{t.length} kr.</span>
              </div>
            ))}
            {d.modifiers.length > 0 && <div className="hint">Rakip başlıklarında sık geçen ifadeler: {d.modifiers.map((m) => <span key={m.term} className="badge badge-neutral" style={{ marginRight: 4 }}>{m.term} ({m.pages})</span>)}</div>}
            <div className="text-2" style={{ fontSize: 13 }}><strong>Meta açıklama:</strong> {d.metaTip}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><ListTree size={17} /> Önerilen yapı</h3></div>
          <div className="card-body">
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13.5 }}>
              {d.outline.map((o, i) => (
                <li key={`${o.text}${i}`} style={{ marginLeft: o.level === 3 ? 18 : 0, listStyle: o.level === 3 ? 'circle' : undefined }}>
                  <strong>{o.level === 2 ? 'H2' : 'H3'}</strong> {o.text} <span className="muted" style={{ fontSize: 12 }}>· {o.why}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Rakiplerin işlediği başlıklar</h3><span className="badge badge-neutral">{d.headings.length}</span></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Başlık</th><th className="r">Rakip</th><th className="r">Sizde</th></tr></thead>
              <tbody>{d.headings.map((h) => <tr key={h.heading}><td>{h.heading}</td><td className="r">{h.pages}/{s.pages}</td><td className="r"><Covered v={h.covered} /></td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Kapsanması gereken terimler</h3><span className="badge badge-neutral">{d.terms.length}</span></div>
          <Tip>Rakip sayfaların çoğunda geçen ifadeler: Google’ın konuyu “eksiksiz” saydığı kavramlar.</Tip>
          <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.terms.map((t) => (
              <span key={t.term} className={`badge ${t.covered === false ? 'badge-critical' : t.covered ? 'badge-good' : 'badge-neutral'}`} title={`${t.pages}/${s.pages} rakip sayfada`}>{t.term} <span style={{ opacity: 0.7 }}>· {t.pages}</span></span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Yanıtlanması gereken sorular</h3><span className="badge badge-neutral">{d.questions.length}</span></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Soru</th><th>Kaynak</th><th className="r">Sizde</th></tr></thead>
              <tbody>{d.questions.map((q) => <tr key={q.question}><td>{q.question}</td><td className="muted" style={{ fontSize: 12 }}>{q.source}</td><td className="r"><Covered v={q.covered} /></td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Aynı sayfada hedeflenecek sorgular</h3><span className="badge badge-neutral">{d.supporting.length}</span></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
            {d.supporting.length ? (
              <table className="table">
                <thead><tr><th>Sorgu (Search Console)</th><th className="r">Gösterim</th><th className="r">Poz.</th></tr></thead>
                <tbody>{d.supporting.map((q) => <tr key={q.query}><td>{q.query}</td><td className="r">{fmt.num(q.impressions)}</td><td className="r"><PositionPill value={q.position} /></td></tr>)}</tbody>
              </table>
            ) : <p className="muted" style={{ padding: 20 }}>Search Console’da bu konuda sorgu yok.</p>}
          </div>
          {d.variations.length > 0 && (
            <div style={{ padding: '10px 20px 18px' }}>
              <div className="hint" style={{ marginBottom: 6 }}>Google otomatik tamamlama varyasyonları</div>
              <div className="row" style={{ gap: 4 }}>{d.variations.map((v) => <span key={v.query} className="badge badge-neutral">{v.query}</span>)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><Link2 size={17} /> İç bağlantılar</h3></div>
          <Tip>Yeni içeriği yayınlayınca bu ilgili sayfalarınızdan ona metin içi bağlantı verin (hedef kelimeyi anchor olarak kullanın).</Tip>
          <div className="url-list" style={{ margin: '10px 20px 20px' }}>
            {d.internalLinks.length ? d.internalLinks.map((l) => <div key={l.url}><a href={safeHref(l.url)} target="_blank" rel="noopener noreferrer" className="truncate" title={l.url}>{shortUrl(l.url)}</a><span className="muted truncate" style={{ maxWidth: 220 }}>{l.terms.join(', ')}</span></div>) : <div className="muted">İlgili sayfa bulunamadı.</div>}
          </div>
          {d.schema.length > 0 && <p className="text-2" style={{ padding: '0 20px 18px', fontSize: 13 }}><strong>Yapısal veri:</strong> rakiplerin çoğu {d.schema.map((x) => x.type).join(', ')} kullanıyor.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><FileText size={17} /> Analiz edilen sayfalar</h3></div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Sayfa</th><th className="r">Kelime</th><th className="r">H2</th><th className="r">Güncelleme</th></tr></thead>
              <tbody>{d.competitors.map((c) => <tr key={c.url}><td><PageLink url={c.url} title={c.title} max={260} /></td><td className="r">{fmt.num(c.words)}</td><td className="r">{c.h2}</td><td className="r muted">{c.modifiedAt || c.publishedAt || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/** İçerik brief'leri: oluştur, listele, görüntüle ve Markdown olarak yazara ver. */
export default function BriefsView({ domain }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selected = params.get('brief');
  const list = useQuery({
    queryKey: ['insights', domain.id, 'briefs'],
    queryFn: () => insightApi.briefs(domain.id),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.briefs?.some(busy) ? 4000 : false),
  });
  const select = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', 'briefs'); n.delete('keyword'); if (id) n.set('brief', id); else n.delete('brief'); return n; }, { replace: true });
  const remove = useMutation({
    mutationFn: (id) => insightApi.removeBrief(domain.id, id),
    onSuccess: (_, id) => { if (selected === id) select(null); qc.invalidateQueries({ queryKey: ['insights', domain.id, 'briefs'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const briefs = list.data?.briefs || [];

  return (
    <div className="stack">
      <CreateForm domain={domain} initialKeyword={params.get('keyword') || ''} onCreated={(id) => { qc.invalidateQueries({ queryKey: ['insights', domain.id, 'briefs'] }); select(id); }} />
      {briefs.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Brief’ler</h3><span className="badge badge-neutral">{briefs.length}</span></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto' }}>
            <table className="table">
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => select(b.id)} style={selected === b.id ? { background: 'var(--primary-soft)' } : undefined}>
                    <td className="cell-main">{b.keyword}</td>
                    <td className="muted">{b.country ? countryName(b.country) : '—'}</td>
                    <td>{busy(b) ? <span className="row" style={{ gap: 6 }}><Spinner size={13} /> Hazırlanıyor</span> : b.status === 'failed' ? <span className="badge badge-critical" title={b.error || ''}>Başarısız</span> : <span className="badge badge-good">Hazır</span>}</td>
                    <td className="r muted">{fmt.dateTime(b.created_at)}</td>
                    <td className="r"><button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); remove.mutate(b.id); }} aria-label="Brief’i sil"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selected ? <BriefDetail key={selected} domain={domain} id={selected} /> : !briefs.length && !list.isLoading ? (
        <div className="card"><EmptyState icon={Sparkles} title="Henüz brief yok">İçerik Fikirleri, Kelime Kümeleri veya SERP takibindeki “Brief” düğmeleriyle ya da yukarıdan bir kelime girerek başlayın.</EmptyState></div>
      ) : null}
    </div>
  );
}
