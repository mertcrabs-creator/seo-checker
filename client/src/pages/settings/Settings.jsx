import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Link2, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { authApi, integrationApi } from '../../api/endpoints';
import { Alert, Skeleton, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { PasswordInput } from '../auth/AuthLayout';
import { fmt } from '../../utils/format';

function GoogleCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = useQuery({ queryKey: ['google-status'], queryFn: integrationApi.googleStatus });

  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    if (g === 'connected') {
      toast.success('Google Search Console bağlandı');
      qc.invalidateQueries({ queryKey: ['google-status'] });
      qc.invalidateQueries({ queryKey: ['google-sites'] });
    } else toast.error('Google bağlantısı tamamlanamadı');
    setParams({}, { replace: true });
  }, [params, setParams, toast, qc]);

  const connect = useMutation({
    mutationFn: integrationApi.googleAuthUrl,
    onSuccess: ({ url }) => {
      // Sadece Google'ın yetkilendirme adresine yönlendir
      if (new URL(url).origin === 'https://accounts.google.com') window.location.assign(url);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disconnect = useMutation({
    mutationFn: integrationApi.googleDisconnect,
    onSuccess: () => {
      toast.success('Google bağlantısı kaldırıldı');
      qc.invalidateQueries({ queryKey: ['google-status'] });
      qc.removeQueries({ queryKey: ['google-sites'] });
    },
  });

  const s = status.data;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Google Search Console</h3>
          <p>Tıklama, gösterim, anahtar kelime ve sayfa verileri için salt-okunur erişim</p>
        </div>
        {s?.connected && <span className="badge badge-good"><CheckCircle2 size={13} /> Bağlı</span>}
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 14 }}>
        {status.isLoading ? <Skeleton height={40} /> : !s?.configured ? (
          <Alert type="warning">
            Sunucuda Google OAuth yapılandırılmamış. <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> ve <code>GOOGLE_REDIRECT_URI</code> değişkenlerini ayarlayın.
          </Alert>
        ) : s.connected ? (
          <>
            <p className="text-2">Hesap: <strong>{s.email || 'Google hesabı'}</strong> · {fmt.dateTime(s.connectedAt)} tarihinde bağlandı</p>
            {s.manageable === false ? <p className="hint">Bu bağlantı hesap sahibine aittir; Search Console verileri bu hesap üzerinden alınır.</p> : <div className="row">
              <button className="btn btn-secondary" onClick={() => connect.mutate()} disabled={connect.isPending}><Link2 size={16} /> Yeniden bağlan</button>
              <button className="btn btn-ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}><Unlink size={16} /> Bağlantıyı kaldır</button>
            </div>}
          </>
        ) : (
          <div>
            {s.manageable === false ? <p className="hint">Google bağlantısını hesap sahibi kurmalıdır.</p> : <button className="btn btn-primary" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? <Spinner size={16} /> : <Link2 size={16} />} Google ile bağlan
            </button>}
          </div>
        )}
      </div>
    </div>
  );
}

function PasswordCard() {
  const { clear } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const change = useMutation({
    mutationFn: () => authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
    // Tüm oturumlar sonlandırılır; yeniden giriş gerekir
    onSuccess: () => clear(),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const valid = form.currentPassword && form.newPassword.length >= 10 && form.newPassword === form.confirm;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="row" style={{ gap: 8 }}><KeyRound size={17} /> Şifre değiştir</h3>
          <p>Değişiklik sonrası tüm cihazlardaki oturumlar kapatılır.</p>
        </div>
      </div>
      <form className="card-body" style={{ display: 'grid', gap: 14, maxWidth: 420 }} onSubmit={(e) => { e.preventDefault(); if (valid) change.mutate(); }}>
        {change.isError && <Alert type="error">{errorMessage(change.error)}</Alert>}
        <div className="field"><label htmlFor="cp">Mevcut şifre</label><PasswordInput id="cp" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} /></div>
        <div className="field">
          <label htmlFor="np">Yeni şifre</label>
          <PasswordInput id="np" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} />
          <span className="hint">En az 10 karakter; büyük harf, küçük harf ve rakam içermeli.</span>
        </div>
        <div className="field">
          <label htmlFor="np2">Yeni şifre (tekrar)</label>
          <PasswordInput id="np2" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
          {form.confirm && form.confirm !== form.newPassword && <span className="field-error">Şifreler eşleşmiyor</span>}
        </div>
        <div><button className="btn btn-primary" disabled={!valid || change.isPending}>{change.isPending ? <Spinner size={16} /> : 'Şifreyi güncelle'}</button></div>
      </form>
    </div>
  );
}

export default function Settings() {
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="page-head"><div><h1>Ayarlar & Entegrasyonlar</h1><p>Veri kaynakları ve hesap güvenliği.</p></div></div>
      <GoogleCard />
      <PasswordCard />
    </div>
  );
}
