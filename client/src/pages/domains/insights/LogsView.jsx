import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, FileClock, Gauge, Layers, ShieldAlert, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorMessage } from '../../../api/client';
import { insightApi } from '../../../api/endpoints';
import { Alert, EmptyState, Skeleton, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { parseLogFile, summarize, verificationTargets } from '../../../utils/logParser';
import { fmt, safeHref, shortUrl } from '../../../utils/format';
import { Tiles, Tip } from './common';

const GROUPS = {
  google: { label: 'Google', color: 'var(--chart-1)' },
  bing: { label: 'Bing', color: 'var(--chart-2)' },
  ai: { label: 'Yapay zekâ', color: 'var(--ramp-4)' },
  seo: { label: 'SEO araçları', color: 'var(--ramp-2)' },
  other: { label: 'Diğer', color: 'var(--border-strong)' },
};
const WASTE = {
  errors: { label: 'Hata (4xx/5xx)', tip: 'Googlebot hatalı adreslere istek atıyor. Kırık iç bağlantıları ve site haritasını düzeltin, kalıcı taşınan sayfalara 301 verin.' },
  redirects: { label: 'Yönlendirme', tip: 'Googlebot yönlendiren adresleri tarıyor. İç bağlantıları ve site haritasını son adrese güncelleyin.' },
  params: { label: 'Parametreli URL', tip: 'Filtre/sıralama/oturum parametreli adresler tarama bütçesini tüketir. Canonical, robots.txt Disallow veya bağlantıları nofollow yapmayı değerlendirin.' },
  noindex: { label: 'noindex sayfa', tip: 'İndekslenmeyecek sayfalara sık tarama. Bu sayfalara iç bağlantıları azaltın; tamamen gereksizse robots.txt ile engelleyin.' },
  unknown: { label: 'Taramada bilinmeyen', tip: 'Sitede bağlantısı olmayan (eski, yetim veya dış bağlantılı) sayfalar. Gerekliyse iç bağlantı verin, değilse 301/410 ile kapatın.' },
};
const STEP_LABELS = { parse: 'Log ayrıştırılıyor', verify: 'Bot IP’leri Google/Bing resmi aralıklarıyla doğrulanıyor', save: 'Analiz kaydediliyor' };

function Uploader({ domainId, onDone }) {
  const toast = useToast();
  const input = useRef(null);
  const [state, setState] = useState(null); // { step, progress, lines, name }
  const [drag, setDrag] = useState(false);

  const run = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 * 1024) return toast.error('Dosya 2 GB’dan büyük olamaz; daha kısa bir dönem seçin');
    try {
      setState({ step: 'parse', progress: 0, lines: 0, name: file.name });
      const parsed = await parseLogFile(file, (p) => setState((s) => ({ ...s, progress: /\.gz$/i.test(file.name) ? null : Math.min(1, p.chars / p.size), lines: p.lines })));
      if (!parsed.hits.ip.length) throw new Error(`${fmt.num(parsed.parsedLines)} satır okundu ama hiç arama motoru / bot isteği bulunamadı.`);
      setState((s) => ({ ...s, step: 'verify', lines: parsed.totalLines }));
      const targets = verificationTargets(parsed);
      const verdicts = targets.length ? (await insightApi.verifyLogIps(domainId, targets)).results : {};
      setState((s) => ({ ...s, step: 'save' }));
      const summary = summarize(parsed, verdicts, file.name);
      const { analysis } = await insightApi.saveLog(domainId, summary);
      toast.success(`${fmt.num(parsed.botLines)} bot isteği analiz edildi`);
      if (parsed.truncated) toast.error('Dosya çok büyük: ilk 3 milyon bot isteği analiz edildi');
      onDone(analysis.id);
    } catch (e) {
      toast.error(e?.response ? errorMessage(e) : e.message || 'Log işlenemedi');
    } finally {
      setState(null);
    }
  };

  return (
    <div
      className="card card-pad"
      style={{ display: 'grid', gap: 12, borderStyle: 'dashed', borderColor: drag ? 'var(--primary)' : undefined, background: drag ? 'var(--primary-soft)' : undefined }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!state) run(e.dataTransfer.files?.[0]); }}
    >
      {state ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ gap: 8 }}><Spinner size={15} /> <strong>{STEP_LABELS[state.step]}</strong> <span className="muted truncate">· {state.name}</span></div>
          {state.step === 'parse' && (
            <>
              <div className="bar-track" style={{ height: 8 }}><div className="bar-fill" style={{ width: `${Math.round((state.progress ?? 0.5) * 100)}%`, transition: 'width .2s' }} /></div>
              <span className="hint">{fmt.num(state.lines)} satır okundu{state.progress !== null && ` · %${Math.round(state.progress * 100)}`}</span>
            </>
          )}
        </div>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'grid', gap: 4, maxWidth: 640 }}>
            <strong className="row" style={{ gap: 8 }}><Upload size={17} /> Sunucu log dosyası yükleyin</strong>
            <span className="text-2" style={{ fontSize: 13 }}>
              Apache/Nginx erişim logu (combined), JSON satırları (Nginx JSON, Cloudflare) veya IIS/W3C. <strong>.gz</strong> dosyalar da olur.
              Dosya <strong>tarayıcınızda</strong> işlenir: ziyaretçi IP’leri ve satırlar sunucuya gönderilmez, yalnızca bot istatistikleri kaydedilir.
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => input.current?.click()}><Upload size={16} /> Dosya seç</button>
          <input ref={input} type="file" hidden accept=".log,.txt,.gz,.json,.jsonl,.csv,text/plain,application/gzip" onChange={(e) => { run(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}

function DailyChart({ daily }) {
  const groups = Object.keys(GROUPS).filter((g) => daily.some((d) => d[g] > 0));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="date" tickFormatter={fmt.dateShort} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={24} tickMargin={6} />
        <YAxis tickFormatter={fmt.compact} tickLine={false} axisLine={false} width={44} />
        <Tooltip labelFormatter={fmt.dateShort} formatter={(v, name) => [fmt.num(v), name]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} cursor={{ fill: 'var(--surface-hover)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {groups.map((g, i) => <Bar key={g} dataKey={g} name={GROUPS[g].label} stackId="a" fill={GROUPS[g].color} radius={i === groups.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

const PathCell = ({ path, hostname }) => (
  <a href={safeHref(`https://${hostname}${path}`)} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block', maxWidth: 420 }} title={path}>{path}</a>
);

function Analysis({ a, hostname }) {
  const s = a.summary;
  const d = s.derived || {};
  const [waste, setWaste] = useState('errors');
  const google = s.bots.filter((b) => b.group === 'google');
  const googleHits = google.reduce((t, b) => t + b.hits - b.fake, 0);
  const verified = google.reduce((t, b) => t + b.verified, 0);
  const fakeHits = s.bots.reduce((t, b) => t + b.fake, 0);
  const googleUrls = s.urls.filter((u) => u.google > 0).length;
  const smartphone = s.bots.find((b) => b.key === 'googlebot-smartphone');
  const desktop = s.bots.find((b) => b.key === 'googlebot-desktop');
  const googleStatuses = s.statuses.filter((x) => x.google > 0).sort((x, y) => y.google - x.google);
  const totalG = googleStatuses.reduce((t, x) => t + x.google, 0) || 1;
  const wasteKeys = Object.keys(WASTE).filter((k) => d.waste?.[k]?.length);

  return (
    <div className="stack">
      <p className="hint">
        {a.file_name} · {s.format} · {fmt.num(s.totalLines)} satır
        {s.rangeStart && ` · ${fmt.dateTime(s.rangeStart)} – ${fmt.dateTime(s.rangeEnd)}`}
      </p>
      <Tiles items={[
        { label: 'Googlebot isteği', value: fmt.num(googleHits), icon: Bot, foot: `${fmt.pct(googleHits ? verified / googleHits : 0)} IP ile doğrulandı` },
        { label: 'Taranan URL', value: fmt.num(googleUrls), icon: Layers, foot: smartphone && desktop ? `Mobil %${Math.round((smartphone.hits / (smartphone.hits + desktop.hits)) * 100)}` : 'Googlebot’un uğradığı' },
        { label: 'Önemli sayfa kapsaması', value: d.coverage === null || d.coverage === undefined ? '—' : fmt.pct(d.coverage), icon: Gauge, tone: d.coverage !== undefined && d.coverage < 0.7 ? 'warning' : 'good', foot: d.audit ? `${fmt.num(d.importantPages)} sayfadan` : 'tarama gerekli' },
        { label: 'Tarama israfı', value: fmt.pct(d.wasteShare || 0), icon: ShieldAlert, tone: d.wasteShare > 0.2 ? 'critical' : undefined, foot: fakeHits ? `${fmt.num(fakeHits)} sahte bot isteği ayıklandı` : 'hata, yönlendirme, parametre, noindex' },
      ]} />

      <div className="card">
        <div className="card-head"><div><h3>Günlük bot trafiği</h3><p>Sahte (IP’si doğrulanamayan) Google/Bing istekleri hariç</p></div></div>
        <div className="card-body">{s.daily.length ? <DailyChart daily={s.daily} /> : <p className="muted">Tarih bilgisi yok.</p>}</div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Botlar</h3></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 360, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Bot</th><th className="r">İstek</th><th className="r">Doğrulanan</th><th className="r">Sahte</th></tr></thead>
              <tbody>
                {s.bots.map((b) => (
                  <tr key={b.key}>
                    <td><span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: GROUPS[b.group].color }} /> {b.label}</span></td>
                    <td className="r">{fmt.num(b.hits)}</td>
                    <td className="r">{b.verified ? <span className="badge badge-good">{fmt.num(b.verified)}</span> : <span className="muted">—</span>}</td>
                    <td className="r">{b.fake ? <span className="badge badge-critical">{fmt.num(b.fake)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Googlebot yanıt kodları ve dosya türleri</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              {googleStatuses.slice(0, 8).map((x) => (
                <div key={x.code} className="bar-cell">
                  <span className={`badge ${x.code.startsWith('2') ? 'badge-good' : x.code.startsWith('3') ? 'badge-warning' : 'badge-critical'}`} style={{ width: 48, justifyContent: 'center' }}>{x.code === '0' ? '?' : x.code}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(x.google / totalG) * 100}%` }} /></div>
                  <span className="num" style={{ fontSize: 12, minWidth: 70, textAlign: 'right' }}>{fmt.num(x.google)} · %{Math.round((x.google / totalG) * 100)}</span>
                </div>
              ))}
            </div>
            <div className="url-list">
              {s.fileTypes.map((t) => <div key={t.type}><span>{t.type}</span><span className="num">{fmt.num(t.hits)}</span></div>)}
            </div>
          </div>
        </div>
      </div>

      {wasteKeys.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3 className="row" style={{ gap: 8 }}><ShieldAlert size={17} /> Tarama bütçesi israfı</h3>
            <div className="segmented" role="tablist" aria-label="İsraf türü">
              {wasteKeys.map((k) => (
                <button key={k} className={(wasteKeys.includes(waste) ? waste : wasteKeys[0]) === k ? 'active' : ''} onClick={() => setWaste(k)} role="tab">{WASTE[k].label} ({d.waste[k].length})</button>
              ))}
            </div>
          </div>
          {(() => {
            const k = wasteKeys.includes(waste) ? waste : wasteKeys[0];
            return (
              <>
                <Tip>{WASTE[k].tip}</Tip>
                <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>Adres</th><th className="r">Googlebot isteği</th><th className="r">Kod</th></tr></thead>
                    <tbody>
                      {d.waste[k].map((w) => (
                        <tr key={w.path}><td><PathCell path={w.path} hostname={hostname} /></td><td className="r">{fmt.num(w.hits)}</td><td className="r">{w.status ?? '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {d.audit && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h3>Googlebot’un uğramadığı önemli sayfalar</h3><span className="badge badge-neutral">{d.notCrawled?.length || 0}</span></div>
            <Tip>Site haritasında olan veya iç bağlantı alan, indekslenebilir sayfalar. Log döneminde hiç taranmadılarsa iç bağlantıyı artırın ve site haritasında lastmod’u güncelleyin.</Tip>
            <div className="table-wrap" style={{ marginTop: 10, maxHeight: 380, overflowY: 'auto' }}>
              {d.notCrawled?.length ? (
                <table className="table">
                  <thead><tr><th>Sayfa</th><th className="r">İç bağ.</th><th className="r">Derinlik</th></tr></thead>
                  <tbody>
                    {d.notCrawled.map((p) => (
                      <tr key={p.url}>
                        <td style={{ maxWidth: 320 }}><a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block' }} title={p.url}>{shortUrl(p.url)}</a><div className="cell-sub truncate">{p.title}</div></td>
                        <td className="r">{fmt.num(p.inlinks)}</td>
                        <td className="r">{p.depth < 0 ? '—' : p.depth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <EmptyState icon={ShieldCheck} title="Hepsi tarandı">Tüm önemli sayfalar log döneminde en az bir kez tarandı.</EmptyState>}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Tıklama derinliğine göre tarama</h3></div>
            <Tip>Ana sayfadan uzaklaştıkça taranma oranı hızla düşüyorsa önemli sayfaları daha sığ bir yapıya (menü, kategori, iç bağlantı) taşıyın.</Tip>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead><tr><th>Derinlik</th><th className="r">Sayfa</th><th>Taranma oranı</th><th className="r">Ort. istek</th></tr></thead>
                <tbody>
                  {(d.byDepth || []).map((x) => (
                    <tr key={x.depth}>
                      <td>{x.depth === 'Bağlantısız' ? x.depth : `${x.depth}. seviye`}</td>
                      <td className="r">{fmt.num(x.pages)}</td>
                      <td><div className="bar-cell"><div className="bar-track"><div className="bar-fill" style={{ width: `${(x.crawled / Math.max(1, x.pages)) * 100}%` }} /></div><span className="num" style={{ fontSize: 12 }}>%{Math.round((x.crawled / Math.max(1, x.pages)) * 100)}</span></div></td>
                      <td className="r">{x.crawled ? fmt.num(Math.round(x.hits / x.crawled)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>En çok taranan adresler (Googlebot)</h3></div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Adres</th><th className="r">İstek</th><th className="r">Son tarama</th></tr></thead>
              <tbody>
                {s.urls.filter((u) => u.google > 0).slice(0, 100).map((u) => (
                  <tr key={u.path}><td><PathCell path={u.path} hostname={hostname} /></td><td className="r">{fmt.num(u.google)}</td><td className="r muted" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(u.lastGoogle)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><Sparkles size={17} /> Yapay zekâ botları</h3></div>
          <Tip>ChatGPT, Claude, Perplexity gibi botların hangi sayfalarınızı okuduğu. Eğitim botlarını (GPTBot, CCBot) robots.txt ile engelleyebilir, arama botlarına (OAI-SearchBot, PerplexityBot) izin vererek AI yanıtlarında kaynak gösterilme şansınızı koruyabilirsiniz.</Tip>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 360, overflowY: 'auto' }}>
            {s.ai.length ? (
              <table className="table">
                <thead><tr><th>Bot</th><th className="r">İstek</th><th className="r">URL</th><th>En çok okunan</th></tr></thead>
                <tbody>
                  {s.ai.map((x) => (
                    <tr key={x.bot}>
                      <td className="cell-main">{x.bot}</td>
                      <td className="r">{fmt.num(x.hits)}</td>
                      <td className="r">{fmt.num(x.urls)}</td>
                      <td className="truncate" style={{ maxWidth: 220 }} title={x.topPaths.map((p) => p.path).join('\n')}>{x.topPaths[0]?.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={Sparkles} title="AI botu isteği yok" />}
          </div>
        </div>
      </div>

      {s.fake.length > 0 && (
        <div className="card">
          <div className="card-head"><h3 className="row" style={{ gap: 8 }}><ShieldAlert size={17} /> Sahte botlar</h3><span className="badge badge-critical">{s.fake.length}</span></div>
          <Tip>Kendini Googlebot/Bingbot olarak tanıtan ama IP’si resmi aralıklarda olmayan istemciler (kazıyıcı, spam). Analizden çıkarıldılar; yoğunsa güvenlik duvarında engelleyin.</Tip>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 300, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>IP</th><th>İddia ettiği bot</th><th className="r">İstek</th></tr></thead>
              <tbody>{s.fake.map((f) => <tr key={`${f.bot}|${f.ip}`}><td className="num">{f.ip}</td><td>{f.bot}</td><td className="r">{fmt.num(f.hits)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sunucu log analizi: Googlebot ve diğer botların siteyi nasıl taradığı, tarama israfı ve sahte botlar. */
export default function LogsView({ domain }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState(undefined);
  const key = ['insights', domain.id, 'logs', selected || 'latest'];
  const { data, isLoading, isError, error } = useQuery({ queryKey: key, queryFn: () => insightApi.logs(domain.id, selected ? { id: selected } : {}) });
  const remove = useMutation({
    mutationFn: (id) => insightApi.removeLog(domain.id, id),
    onSuccess: () => {
      setSelected(undefined);
      qc.invalidateQueries({ queryKey: ['insights', domain.id, 'logs'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const current = data?.current;
  const list = useMemo(() => data?.list || [], [data]);

  return (
    <div className="stack">
      <Uploader domainId={domain.id} onDone={(id) => { setSelected(id); qc.invalidateQueries({ queryKey: ['insights', domain.id, 'logs'] }); }} />
      {isLoading ? <Skeleton height={300} /> : isError ? <Alert type="error">{errorMessage(error)}</Alert> : !current ? (
        <div className="card">
          <EmptyState icon={FileClock} title="Henüz log analizi yok">
            Hosting panelinizden (cPanel → Raw Access / Metrics, Plesk → Logs, Nginx/Apache sunucuda /var/log/…/access.log) son 1–4 haftalık erişim logunu indirip yükleyin.
            Googlebot’un hangi sayfaları ne sıklıkla taradığını, hata ve yönlendirmelere ne kadar bütçe harcadığını ve hiç uğramadığı önemli sayfaları gösterir.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <select className="select select-sm" style={{ maxWidth: 420 }} value={current.id} onChange={(e) => setSelected(e.target.value)} aria-label="Analiz geçmişi">
                {list.map((l) => <option key={l.id} value={l.id}>{fmt.dateTime(l.created_at)} · {l.file_name} · {fmt.num(l.bot_hits)} bot isteği</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => remove.mutate(current.id)} disabled={remove.isPending}><Trash2 size={14} /> Bu analizi sil</button>
          </div>
          <Analysis a={current} hostname={domain.hostname} />
        </>
      )}
    </div>
  );
}
