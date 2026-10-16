import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Globe, KeyRound, ScanSearch, Wrench, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { analyzeApi } from '../../api/endpoints';
import { Alert, EmptyState, ScoreRing, SeverityBadge, Spinner } from '../../components/ui/Feedback';
import { fmt, safeHref } from '../../utils/format';
import { Flag } from '../domains/site/shared';

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Google arama sonucu önizlemesi (yaklaşık karakter sınırlarıyla). */
function SerpPreview({ url, title, description }) {
  let crumb = url;
  try {
    const u = new URL(url);
    crumb = [u.hostname, ...decodeURI(u.pathname).split('/').filter(Boolean)].join(' › ');
  } catch {
    /* ham URL */
  }
  return (
    <div className="card card-pad" style={{ display: 'grid', gap: 4 }}>
      <small className="muted" style={{ marginBottom: 6 }}>Google arama sonucu önizlemesi</small>
      <div className="truncate" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{crumb}</div>
      <div style={{ fontSize: 19, color: 'var(--primary)', lineHeight: 1.3 }}>{clip(title, 62) || <span className="muted">Title yok</span>}</div>
      <div className="text-2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{clip(description, 160) || <span className="muted">Meta açıklama yok, Google sayfadan bir metin seçer.</span>}</div>
    </div>
  );
}

const LengthHint = ({ value, min, max }) => {
  if (!value) return <span className="badge badge-critical">Yok</span>;
  const ok = value.length >= min && value.length <= max;
  return <span className={`badge ${ok ? 'badge-good' : 'badge-warning'} num`}>{value.length} karakter</span>;
};

function Report({ r }) {
  const p = r.page;
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="card card-pad row" style={{ gap: 20, flexWrap: 'nowrap' }}>
          <ScoreRing score={r.score} size={112} label="Sayfa puanı" />
          <div style={{ display: 'grid', gap: 6, minWidth: 0, fontSize: 13 }}>
            <a href={safeHref(r.finalUrl)} target="_blank" rel="noopener noreferrer" className="truncate" title={r.finalUrl}>{r.finalUrl}</a>
            <span className="text-2">HTTP {r.response.status} · TTFB {fmt.ms(r.response.ttfb)} · {fmt.bytes(r.response.decodedBytes)}</span>
            <span className="text-2">
              {r.response.https ? 'HTTPS' : 'HTTP'} · {r.response.compression ? `${r.response.compression} sıkıştırma` : 'Sıkıştırma yok'}
              {r.response.redirects.length ? ` · ${r.response.redirects.length} yönlendirme` : ''}
            </span>
            <span className="muted">{fmt.dateTime(r.analyzedAt)}</span>
          </div>
        </div>
        {r.target && (
          <div className="card card-pad row" style={{ gap: 20, flexWrap: 'nowrap' }}>
            <ScoreRing score={r.target.score} size={112} label="Kelime uyumu" />
            <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <strong className="row" style={{ gap: 6 }}><KeyRound size={15} /> {r.target.keyword}</strong>
              <span className="text-2">İçerikte {fmt.num(r.target.occurrences)} kez · yoğunluk %{fmt.num(r.target.density)}</span>
              <span className="text-2">{r.target.checks.filter((c) => c.pass).length}/{r.target.checks.length} kontrol geçti</span>
            </div>
          </div>
        )}
        <SerpPreview url={r.finalUrl} title={p.title} description={p.metaDescription} />
      </div>

      {r.target && (
        <div className="card">
          <div className="card-head"><h3>Hedef kelime kontrolleri</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {r.target.checks.map((c) => (
              <div key={c.key} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 10 }}>
                {c.pass ? <CheckCircle2 size={18} style={{ color: 'var(--good)', flex: 'none' }} /> : <XCircle size={18} style={{ color: 'var(--critical)', flex: 'none' }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{c.label}{c.value && <span className="muted num"> · {c.value}</span>}</div>
                  {!c.pass && <div className="text-2" style={{ fontSize: 12.5 }}>{c.tip}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card card-pad" style={{ display: 'grid', gap: 12, fontSize: 13.5, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>Meta bilgileri</h3>
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><small className="muted">Title</small><LengthHint value={p.title} min={30} max={60} /></div>
            <div style={{ wordBreak: 'break-word' }}>{p.title || '—'}</div>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><small className="muted">Meta açıklama</small><LengthHint value={p.metaDescription} min={70} max={160} /></div>
            <div style={{ wordBreak: 'break-word' }}>{p.metaDescription || '—'}</div>
          </div>
          <div style={{ display: 'grid', gap: 4 }}><small className="muted">H1</small><div>{p.h1 || '—'}</div></div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div style={{ display: 'grid', gap: 4 }}><small className="muted">Canonical</small><div className="truncate" title={p.canonical || ''}>{p.canonical || '—'}</div></div>
            <div style={{ display: 'grid', gap: 4 }}><small className="muted">Dil / indeksleme</small><div>{p.lang || '—'} · {p.noindex ? 'noindex' : 'İndekslenebilir'}</div></div>
          </div>
        </div>
        <div className="card card-pad" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <h3 style={{ fontSize: 15 }}>İçerik</h3>
          <div className="grid grid-3" style={{ gap: 10 }}>
            <div className="metric-tile"><small>Kelime</small><strong className="num">{fmt.num(p.contentWords)}</strong></div>
            <div className="metric-tile"><small>H2 başlık</small><strong className="num">{fmt.num(p.h2Count)}</strong></div>
            <div className="metric-tile"><small>Görsel (alt’sız)</small><strong className="num">{fmt.num(p.images)} ({fmt.num(p.imagesNoAlt)})</strong></div>
            <div className="metric-tile"><small>İç bağlantı</small><strong className="num">{fmt.num(p.internalLinks)}</strong></div>
            <div className="metric-tile"><small>Dış bağlantı</small><strong className="num">{fmt.num(p.externalLinks)}</strong></div>
            <div className="metric-tile"><small>Yapısal veri</small><strong className="num">{fmt.num(p.schemaTypes.length)}</strong></div>
          </div>
          {!!p.schemaTypes.length && <div className="row" style={{ gap: 6 }}>{p.schemaTypes.map((t) => <span key={t} className="badge badge-neutral">{t}</span>)}</div>}
          <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <small className="muted">Sosyal paylaşım (Open Graph)</small>
            <div className="truncate">{r.social.ogTitle || <span className="muted">og:title yok</span>}</div>
            <div className="text-2 truncate">{r.social.ogDescription || 'og:description yok'}</div>
            <div className="text-2">{r.social.ogImage ? 'og:image var' : 'og:image yok'} · {r.social.twitterCard ? `twitter:card ${r.social.twitterCard}` : 'twitter:card yok'}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Sorunlar ve çözümleri</h3><span className="badge badge-neutral">{r.issues.length}</span></div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          {r.issues.map((i) => (
            <div key={i.code} style={{ display: 'grid', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 8 }}>
                <SeverityBadge severity={i.severity} /><strong>{i.title}</strong><span className="badge badge-neutral">{i.categoryLabel}</span>
              </div>
              <p className="text-2" style={{ fontSize: 13 }}>{i.description}</p>
              {!!i.details.length && <div className="muted truncate" style={{ fontSize: 12.5 }}>{i.details.join(' · ')}</div>}
              <div className="issue-fix"><Wrench size={16} /><div>{i.fix}</div></div>
            </div>
          ))}
          {!r.issues.length && <p className="muted">Sayfa içi sorun bulunmadı.</p>}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><h3>Sayfanın anahtar kelimeleri</h3><p>İçerikten çıkarılan, ağırlığa göre sıralı</p></div></div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Kelime</th><th className="r">Geçiş</th><th className="r">Yoğunluk</th><th className="r">Title</th><th className="r">H1</th><th className="r">Meta</th></tr></thead>
              <tbody>
                {r.keywords.map((k) => (
                  <tr key={k.keyword}>
                    <td className="cell-main">{k.keyword}</td>
                    <td className="r">{fmt.num(k.count)}</td>
                    <td className="r">%{fmt.num(k.density)}</td>
                    <td className="r"><Flag on={k.inTitle} label="Title" /></td>
                    <td className="r"><Flag on={k.inH1} label="H1" /></td>
                    <td className="r"><Flag on={k.inMeta} label="Meta açıklama" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Başlık yapısı</h3><span className="badge badge-neutral">{r.outline.length}</span></div>
          <div className="card-body" style={{ display: 'grid', gap: 6, maxHeight: 460, overflowY: 'auto', fontSize: 13 }}>
            {r.outline.map((h, i) => (
              <div key={i} className="row" style={{ gap: 8, flexWrap: 'nowrap', paddingLeft: (h.level - 1) * 16 }}>
                <span className={`badge ${h.level === 1 ? 'badge-good' : 'badge-neutral'}`} style={{ flex: 'none' }}>H{h.level}</span>
                <span className="truncate" title={h.text}>{h.text || <span className="muted">(boş)</span>}</span>
              </div>
            ))}
            {!r.outline.length && <p className="muted">Sayfada başlık etiketi yok.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PageAnalyzer() {
  const [params, setParams] = useSearchParams();
  const [url, setUrl] = useState(params.get('url') || '');
  const [keyword, setKeyword] = useState(params.get('keyword') || '');
  const run = useMutation({ mutationFn: analyzeApi.run });
  const submit = (e) => {
    e?.preventDefault();
    if (!url.trim() || run.isPending) return;
    setParams({ url: url.trim(), ...(keyword.trim() && { keyword: keyword.trim() }) }, { replace: true });
    run.mutate({ url: url.trim(), ...(keyword.trim() && { keyword: keyword.trim() }) });
  };
  // Site sayfaları ekranından "Canlı analiz" ile gelindiyse otomatik başlat
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRan.current && params.get('url')) {
      autoRan.current = true;
      submit();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Sayfa Analizi</h1>
          <p>Kendi sayfanızı veya bir rakip sayfasını anında analiz edin. İsterseniz hedef anahtar kelimeye göre uyumunu da kontrol edin.</p>
        </div>
      </div>

      <form className="card card-pad analyze-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="az-url">Sayfa URL’si</label>
          <div className="input-icon">
            <Globe size={16} />
            <input id="az-url" className="input" placeholder="https://ornek.com/sayfa" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="az-kw">Hedef kelime (isteğe bağlı)</label>
          <div className="input-icon">
            <KeyRound size={16} />
            <input id="az-kw" className="input" placeholder="kırmızı elbise" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={100} />
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={!url.trim() || run.isPending}>
          {run.isPending ? <Spinner size={16} /> : <><ScanSearch size={16} /> Analiz et</>}
        </button>
      </form>

      {run.isError && <Alert type="error">{errorMessage(run.error)}</Alert>}
      {run.isPending ? (
        <div className="card"><EmptyState icon={ScanSearch} title="Sayfa analiz ediliyor">Sayfa indiriliyor ve inceleniyor… <Spinner size={14} /></EmptyState></div>
      ) : run.data ? (
        <Report r={run.data} />
      ) : (
        !run.isError && (
          <div className="card">
            <EmptyState icon={ScanSearch} title="Bir URL girin">
              Title, meta açıklama, başlık yapısı, içerik, anahtar kelimeler, bağlantılar, görseller, yapısal veri, sosyal etiketler ve
              teknik yanıt tek raporda. Search Console gerekmez.
            </EmptyState>
          </div>
        )
      )}
    </div>
  );
}
