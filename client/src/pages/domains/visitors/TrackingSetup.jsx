import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Code2, Copy, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../../api/client';
import { trackingApi } from '../../../api/endpoints';
import { Alert, Modal, Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { fmt } from '../../../utils/format';

/** Panelin ürettiği kurulum kodları. Script dinamik eklenir; yüklenmeden yapılan crabrank(...) çağrıları kuyrukta bekler. */
const SNIPPETS = {
  standard: {
    label: 'Standart',
    hint: 'Sitenin <head> bölümüne, diğer scriptlerden önce ekleyin. Yüklenmeden önce yapılan crabrank(...) çağrıları da kaybolmaz.',
    code: (src, key) => `<!-- CrabRank -->
<script>
  (function(c,r,a,b){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  b=r.createElement("script");b.async=1;b.src="${src}";
  b.setAttribute("data-key","${key}");r.head.appendChild(b)})(window,document,"crabrank");
</script>`,
  },
  simple: {
    label: 'Tek satır',
    hint: 'WordPress “Header/Footer kodu” eklentileri, Google Tag Manager (Özel HTML etiketi, tüm sayfalar) veya site oluşturucular için.',
    code: (src, key) => `<script async src="${src}" data-key="${key}"></script>`,
  },
  conversion: {
    label: 'Özel dönüşüm',
    hint: 'Telefon, WhatsApp, e-posta tıklamaları ve form gönderimleri kod eklemeden yakalanır. Diğer hedefler için bu iki yoldan birini kullanın.',
    code: () => `<!-- 1) Herhangi bir öğeye nitelik ekleyin -->
<button data-crabrank-conversion="randevu-talebi">Randevu al</button>

<!-- 2) Veya JavaScript ile -->
<script>crabrank('conversion', 'randevu-talebi');</script>

<!-- Çerez onayı reddedildiğinde (isteğe bağlı) -->
<script>crabrank('optout');</script>`,
  },
};

function CodeBlock({ code }) {
  const toast = useToast();
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ margin: 0, padding: '14px 110px 14px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{code}</pre>
      <button
        className="btn btn-secondary btn-sm" style={{ position: 'absolute', top: 8, right: 8 }}
        onClick={() => navigator.clipboard.writeText(code).then(() => toast.success('Kod kopyalandı'), () => toast.error('Kopyalanamadı'))}
      >
        <Copy size={13} /> Kopyala
      </button>
    </div>
  );
}

function VerifyResult({ r }) {
  if (r.keyFound && r.receiving) return <Alert type="success">Kurulum tamam: kod sitede bulundu ve veri geliyor.</Alert>;
  if (r.keyFound) return <Alert type="info">Kod sitede bulundu. İlk ziyaretle birlikte veriler görünmeye başlar (önbellek eklentisi varsa önbelleği temizleyin).</Alert>;
  if (r.otherKey) return <Alert type="warning">Sitede farklı bir anahtar var (<code>{r.otherKey.slice(0, 10)}…</code>). Kodu buradaki güncel anahtarla değiştirin.</Alert>;
  if (r.error) return <Alert type="error">{r.error}</Alert>;
  if (r.receiving) return <Alert type="success">Veri geliyor. Kod ana sayfanın HTML’inde görünmüyor; Tag Manager veya eklentiyle yükleniyor olabilir, bu normal.</Alert>;
  return <Alert type="warning">Kod <strong>{r.url}</strong> adresinde bulunamadı. Kodun &lt;head&gt; içinde olduğundan emin olun ve önbelleği temizleyin.</Alert>;
}

export default function TrackingSetup({ domain, data }) {
  const id = domain.id;
  const qc = useQueryClient();
  const toast = useToast();
  const site = data.site;
  const receiving = Boolean(site.last_event_at && Date.now() - new Date(site.last_event_at) < 86_400_000);
  const [open, setOpen] = useState(!site.last_event_at);
  const [variant, setVariant] = useState('standard');
  const [hosts, setHosts] = useState((site.allowed_hosts || []).join(', '));
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [verify, setVerify] = useState(null);

  const onSaved = (res, msg) => {
    qc.setQueryData(['tracking', id, 'site'], res);
    if (msg) toast.success(msg);
  };
  const update = useMutation({
    mutationFn: (body) => trackingApi.update(id, body),
    onSuccess: (res, body) => onSaved(res, body.enabled === undefined ? 'Alan adları kaydedildi' : body.enabled ? 'Takip açıldı' : 'Takip duraklatıldı'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rotate = useMutation({
    mutationFn: () => trackingApi.rotate(id),
    onSuccess: (res) => {
      setConfirmRotate(false);
      setOpen(true);
      onSaved(res, 'Yeni anahtar oluşturuldu. Eski anahtar 7 gün daha çalışır.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const check = useMutation({
    mutationFn: () => trackingApi.verify(id),
    onSuccess: setVerify,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const snippet = SNIPPETS[variant];
  const origin = (() => {
    try {
      return new URL(data.scriptUrl).origin;
    } catch {
      return data.scriptUrl;
    }
  })();
  const saveHosts = () => update.mutate({ allowedHosts: hosts.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean) });

  return (
    <div className="card">
      <div className="card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <button className="row" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ gap: 10, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="stat-icon"><Code2 size={16} /></span>
          <span style={{ display: 'grid', gap: 2 }}>
            <strong style={{ fontSize: 15 }}>Takip kodu</strong>
            <span className="hint">
              {!site.enabled ? 'Duraklatıldı: yeni veri kabul edilmiyor' : site.last_event_at ? `Son veri ${fmt.dateTime(site.last_event_at)}` : 'Kurulum bekleniyor'}
            </span>
          </span>
        </button>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${!site.enabled ? 'badge-neutral' : receiving ? 'badge-good' : 'badge-warning'}`}>
            {!site.enabled ? 'Duraklatıldı' : receiving ? 'Veri geliyor' : site.last_event_at ? '24 saattir veri yok' : 'Henüz veri yok'}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? <Spinner size={14} /> : <ShieldCheck size={15} />} Kurulumu doğrula
          </button>
        </div>
      </div>

      {verify && <div style={{ padding: '0 22px 16px' }}><VerifyResult r={verify} /></div>}

      {open && (
        <div className="card-pad stack" style={{ borderTop: '1px solid var(--border)', gap: 16 }}>
          <div className="segmented" role="tablist" aria-label="Kurulum türü">
            {Object.entries(SNIPPETS).map(([k, v]) => (
              <button key={k} className={variant === k ? 'active' : ''} onClick={() => setVariant(k)} role="tab" aria-selected={variant === k}>{v.label}</button>
            ))}
          </div>
          <p className="text-2" style={{ fontSize: 13 }}>{snippet.hint}</p>
          <CodeBlock code={snippet.code(data.scriptUrl, site.site_key)} />

          <div className="grid grid-2" style={{ gap: 16 }}>
            <div className="field">
              <label htmlFor="trk-hosts">Ek alan adları (isteğe bağlı)</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  id="trk-hosts" className="input input-sm" value={hosts} onChange={(e) => setHosts(e.target.value)} maxLength={2000}
                  placeholder="ornek.de, *.ornek-klinik.com" onKeyDown={(e) => e.key === 'Enter' && saveHosts()}
                />
                <button className="btn btn-secondary btn-sm" onClick={saveHosts} disabled={update.isPending}>Kaydet</button>
              </div>
              <span className="hint">{domain.hostname} ve tüm alt alan adları her zaman kabul edilir. Başka alan adlarından gelen veri reddedilir.</span>
            </div>
            <div className="field">
              <label>Site anahtarı</label>
              <div className="row" style={{ gap: 8 }}>
                <code style={{ padding: '7px 10px', fontSize: 12.5 }}><KeyRound size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{site.site_key}</code>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRotate(true)}><RefreshCw size={14} /> Yenile</button>
              </div>
              <span className="hint">
                Anahtar gizli değildir (sitenin kaynağında görünür); güvenlik alan adı kontrolüyle sağlanır.
                {site.previous_key_expires_at && new Date(site.previous_key_expires_at) > new Date() && ` Eski anahtar ${fmt.dateTime(site.previous_key_expires_at)} tarihine kadar çalışır.`}
              </span>
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={site.enabled} onChange={(e) => update.mutate({ enabled: e.target.checked })} disabled={update.isPending} />
              Veri toplama açık
            </label>
            <span className="hint">
              Sitede İçerik Güvenliği Politikası (CSP) varsa: <code>script-src {origin}</code> ve <code>connect-src {origin}</code> ekleyin.
            </span>
          </div>
          <Alert type="info">
            Çerez ve yerel depolama kullanılmaz, IP adresi saklanmaz, form içerikleri okunmaz. Ziyaretçi kimliği her gün sıfırlanan tek yönlü bir özetten üretilir.
            Ham sayfa verisi {data.retention.pageviewDays} gün, oturum özetleri {data.retention.sessionDays} gün tutulur.
          </Alert>
        </div>
      )}

      {confirmRotate && (
        <Modal
          title="Anahtarı yenile"
          onClose={() => setConfirmRotate(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirmRotate(false)}>Vazgeç</button>
              <button className="btn btn-primary" onClick={() => rotate.mutate()} disabled={rotate.isPending}>{rotate.isPending ? <Spinner size={16} /> : 'Yeni anahtar oluştur'}</button>
            </>
          }
        >
          <p>Yeni bir site anahtarı oluşturulacak. Eski anahtar <strong>7 gün</strong> daha kabul edilir; bu sürede sitedeki kodu yenisiyle değiştirin.</p>
        </Modal>
      )}
    </div>
  );
}
