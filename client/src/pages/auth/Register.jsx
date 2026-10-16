import { useQuery } from '@tanstack/react-query';
import { Check, Mail, User, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { authApi } from '../../api/endpoints';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout, PasswordInput } from './AuthLayout';

// Sunucudaki kuralların aynısı (asıl doğrulama sunucuda)
const RULES = [
  { test: (p) => p.length >= 10, label: 'En az 10 karakter' },
  { test: (p) => /[a-zçğıöşü]/.test(p), label: 'Küçük harf' },
  { test: (p) => /[A-ZÇĞİÖŞÜ]/.test(p), label: 'Büyük harf' },
  { test: (p) => /\d/.test(p), label: 'Rakam' },
];
const METER = ['var(--critical)', 'var(--serious)', 'var(--warning)', 'var(--good)'];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { data: cfg, isLoading } = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config });

  const passed = RULES.filter((r) => r.test(form.password)).length;
  const valid = form.name.trim().length >= 2 && form.email && passed === RULES.length && form.password === form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setError('');
    setLoading(true);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/domains', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Kayıt oluşturulamadı'));
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (!isLoading && cfg && !cfg.registrationOpen) {
    return (
      <AuthLayout>
        <h1>Kayıt kapalı</h1>
        <Alert type="info">Yeni hesaplar yönetici tarafından oluşturulur.</Alert>
        <Link to="/login" className="btn btn-secondary">Girişe dön</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div>
        <h1>Hesap oluşturun</h1>
        <p className="text-2" style={{ marginTop: 6 }}>İlk oluşturulan hesap yönetici olur.</p>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="name">Ad Soyad</label>
          <div className="input-icon">
            <User size={16} />
            <input id="name" className="input" autoComplete="name" maxLength={100} value={form.name} onChange={set('name')} autoFocus />
          </div>
        </div>
        <div className="field">
          <label htmlFor="email">E-posta</label>
          <div className="input-icon">
            <Mail size={16} />
            <input id="email" className="input" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={set('email')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="password">Şifre</label>
          <PasswordInput id="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
          <div className="pw-meter" aria-hidden="true">
            {RULES.map((_, i) => <span key={i} style={i < passed ? { background: METER[passed - 1] } : undefined} />)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
            {RULES.map((r) => {
              const ok = r.test(form.password);
              return (
                <span key={r.label} className="hint row" style={{ gap: 4, color: ok ? 'var(--good-ink)' : undefined }}>
                  {ok ? <Check size={13} /> : <X size={13} />} {r.label}
                </span>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label htmlFor="confirm">Şifre (tekrar)</label>
          <PasswordInput id="confirm" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
          {form.confirm && form.confirm !== form.password && <span className="field-error">Şifreler eşleşmiyor</span>}
        </div>
        <button className="btn btn-primary btn-block" style={{ height: 44 }} disabled={loading || !valid}>
          {loading ? <Spinner size={16} /> : 'Hesap oluştur'}
        </button>
      </form>
      <p className="text-2" style={{ textAlign: 'center' }}>
        Zaten hesabınız var mı? <Link to="/login">Giriş yapın</Link>
      </p>
    </AuthLayout>
  );
}
