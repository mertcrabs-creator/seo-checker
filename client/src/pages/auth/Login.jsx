import { Mail } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { authApi } from '../../api/endpoints';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout, PasswordInput } from './AuthLayout';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { data: cfg } = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ email: form.email.trim(), password: form.password });
      // Sadece uygulama içi yollara yönlendir (open redirect koruması)
      const from = location.state?.from;
      navigate(typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/domains', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Giriş yapılamadı'));
      setForm((f) => ({ ...f, password: '' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div>
        <h1>Tekrar hoş geldiniz</h1>
        <p className="text-2" style={{ marginTop: 6 }}>Panele erişmek için giriş yapın.</p>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">E-posta</label>
          <div className="input-icon">
            <Mail size={16} />
            <input
              id="email" className="input" type="email" autoComplete="username" required maxLength={254}
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ornek@sirket.com" autoFocus
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="password">Şifre</label>
          <PasswordInput id="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className="btn btn-primary btn-block" style={{ height: 44 }} disabled={loading || !form.email || !form.password}>
          {loading ? <Spinner size={16} /> : 'Giriş yap'}
        </button>
      </form>
      {cfg?.registrationOpen && (
        <p className="text-2" style={{ textAlign: 'center' }}>
          Hesabınız yok mu? <Link to="/register">Kayıt olun</Link>
        </p>
      )}
    </AuthLayout>
  );
}
