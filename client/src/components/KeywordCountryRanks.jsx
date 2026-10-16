import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, SearchCheck } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../api/client';
import { domainApi, integrationApi } from '../api/endpoints';
import { countryName, fmt, safeHref, shortUrl } from '../utils/format';
import { PositionPill } from './ui/DataTable';
import { Alert, Skeleton, Spinner } from './ui/Feedback';
import { useToast } from './ui/Toast';

const CONFIDENCE = {
  high: { label: 'Güvenilir', cls: 'badge-good', tip: '100+ gösterim: ortalama gerçek sıraya yakın' },
  medium: { label: 'Orta', cls: 'badge-notice', tip: '20–99 gösterim: yön doğru, sayı oynak olabilir' },
  low: { label: 'Az veri', cls: 'badge-warning', tip: '20’den az gösterim: ortalama yanıltıcı olabilir, canlı doğrulayın' },
};

function LiveResult({ check }) {
  return (
    <div className="card card-pad" style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          {countryName(check.country)} · {check.device === 'mobile' ? 'Mobil' : 'Masaüstü'} · canlı Google sonucu
        </strong>
        <span className="muted" style={{ fontSize: 12 }}>{fmt.dateTime(check.checked_at)}</span>
      </div>
      {check.corrected_query && (
        <Alert type="warning">
          Google bu aramayı <strong>“{check.corrected_query}”</strong> olarak düzeltip o sonuçları gösteriyor. Kullanıcıların çoğu düzeltilmiş sonuçları görür.
        </Alert>
      )}
      <p className="text-2" style={{ fontSize: 13 }}>
        {check.position
          ? <>Siteniz <strong>{check.position}.</strong> sırada: <a href={safeHref(check.url)} target="_blank" rel="noopener noreferrer">{shortUrl(check.url)}</a></>
          : <>Siteniz ilk {check.depth} organik sonuçta yok.</>}
      </p>
      <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th className="r" style={{ width: 40 }}>#</th><th>Sonuç</th></tr></thead>
          <tbody>
            {(check.top || []).map((t) => (
              <tr key={t.position} style={t.own ? { background: 'var(--primary-soft)' } : undefined}>
                <td className="r num">{t.position}</td>
                <td>
                  <div className="cell-main truncate" style={{ maxWidth: 520 }}>{t.title}</div>
                  <a href={safeHref(t.link)} target="_blank" rel="noopener noreferrer" className="cell-sub truncate" style={{ display: 'block', maxWidth: 520 }}>{t.domain}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Kelimenin ülke bazında en doğru sırası: Search Console (28 gün, son 7 gün, mobil/masaüstü, güven)
 * ve isteğe bağlı canlı Google doğrulaması.
 */
export default function KeywordCountryRanks({ domainId, keyword }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [device, setDevice] = useState('desktop');
  const [openKey, setOpenKey] = useState(null);
  const insight = useQuery({ queryKey: ['gsc', domainId, 'insight', keyword], queryFn: () => domainApi.keywordInsight(domainId, keyword) });
  const serpapi = useQuery({ queryKey: ['serpapi-status'], queryFn: integrationApi.serpapiStatus, staleTime: 60_000 });
  const checks = useQuery({
    queryKey: ['serp', domainId, keyword],
    queryFn: () => domainApi.serpChecks(domainId, keyword),
    enabled: Boolean(serpapi.data?.enabled),
  });
  const run = useMutation({
    mutationFn: (country) => domainApi.serpCheck(domainId, { query: keyword, country, device }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['serp', domainId, keyword] });
      qc.invalidateQueries({ queryKey: ['serpapi-status'] });
      setOpenKey(`${r.country}:${r.device}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const live = new Map((checks.data?.checks || []).map((c) => [`${c.country}:${c.device}`, c]));
  const opened = openKey && live.get(openKey);
  const enabled = serpapi.data?.enabled;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4 style={{ fontSize: 14 }}>Ülkelere göre sıralama ({insight.data?.countries?.length ?? 0} ülke)</h4>
        {enabled && (
          <div className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Canlı doğrulama{serpapi.data?.searchesLeft !== null && serpapi.data?.searchesLeft !== undefined ? ` · ${fmt.num(serpapi.data.searchesLeft)} arama hakkı` : ''}
            </span>
            <div className="segmented" role="tablist" aria-label="Cihaz">
              <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}>Masaüstü</button>
              <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}>Mobil</button>
            </div>
          </div>
        )}
      </div>
      <p className="hint row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 6 }}>
        <Info size={14} style={{ flex: 'none', marginTop: 2 }} />
        Search Console pozisyonu, o ülkedeki tüm gösterimlerin ortalamasıdır; şehir, cihaz ve kişiselleştirmeye göre değişir. Türkiye’den “konum: ABD” ile yapılan arama ABD’deki bir kullanıcının gördüğüyle aynı değildir; doğru sonuç için az veri olan satırları canlı doğrulayın.
      </p>
      {serpapi.data?.error && <Alert type="warning">Canlı doğrulama kullanılamıyor: {serpapi.data.error}</Alert>}
      {insight.isError && <Alert type="error">{errorMessage(insight.error)}</Alert>}
      <div className="card table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Ülke</th><th className="r">Ort. (28 gün)</th><th className="r">Son 7 gün</th><th className="r">Mobil</th>
              <th className="r">Masaüstü</th><th className="r">Gösterim</th><th className="r">Canlı Google</th>
            </tr>
          </thead>
          <tbody>
            {insight.isLoading ? (
              <tr><td colSpan={7}><Skeleton height={80} /></td></tr>
            ) : (insight.data?.countries || []).map((c) => {
              const conf = CONFIDENCE[c.confidence];
              const check = live.get(`${c.country}:${device}`);
              const busy = run.isPending && run.variables === c.country;
              return (
                <tr key={c.country}>
                  <td>{countryName(c.country)}</td>
                  <td className="r">
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <span className={`badge ${conf.cls}`} title={conf.tip}>{conf.label}</span>
                      <PositionPill value={c.position} />
                    </span>
                  </td>
                  <td className="r">{c.last7 ? <PositionPill value={c.last7.position} /> : <span className="muted">—</span>}</td>
                  <td className="r" title={c.devices.mobile ? `${c.devices.mobile.impressions} gösterim` : ''}>{c.devices.mobile ? <PositionPill value={c.devices.mobile.position} /> : '—'}</td>
                  <td className="r" title={c.devices.desktop ? `${c.devices.desktop.impressions} gösterim` : ''}>{c.devices.desktop ? <PositionPill value={c.devices.desktop.position} /> : '—'}</td>
                  <td className="r">{fmt.num(c.impressions)}</td>
                  <td className="r">
                    {!enabled ? (
                      <span className="muted" title="Sunucuda SERPAPI_KEY tanımlanınca aktif olur">—</span>
                    ) : check ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setOpenKey(openKey === `${c.country}:${device}` ? null : `${c.country}:${device}`)} title="Sonuçları göster">
                        {check.corrected_query && <AlertTriangle size={13} style={{ color: 'var(--warning-ink)' }} />}
                        {check.position ? <PositionPill value={check.position} /> : <span className="muted">{check.depth}+</span>}
                      </button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => run.mutate(c.country)} disabled={run.isPending || !c.iso2}>
                        {busy ? <Spinner size={13} /> : <><SearchCheck size={14} /> Doğrula</>}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!insight.isLoading && !insight.data?.countries?.length && <tr><td colSpan={7} className="muted">Son 28 günde bu kelimede gösterim yok.</td></tr>}
          </tbody>
        </table>
      </div>
      {!enabled && serpapi.isSuccess && (
        <p className="hint">
          Canlı Google doğrulaması için ücretsiz bir SerpApi anahtarı (ayda ~250 arama) alıp sunucudaki <code>.env</code> dosyasına <code>SERPAPI_KEY</code> olarak ekleyin.
        </p>
      )}
      {opened && <LiveResult check={opened} />}
    </div>
  );
}
