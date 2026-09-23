'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Layers3, ShieldCheck, Eye, EyeOff } from 'lucide-react';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      if (!res.ok)
        throw new Error(
          res.status === 429
            ? 'Trop de tentatives. Patientez une minute.'
            : 'Connexion impossible. Vérifiez vos identifiants.',
        );
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>
          patrimoine<span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">UNE VUE D’ENSEMBLE, ENFIN.</span>
          <h1>
            Tout ce que vous
            <br />
            construisez,
            <br />
            <em>au même endroit.</em>
          </h1>
          <p>
            Investissements, métaux précieux et collections.
            <br />
            Gardez le fil de votre patrimoine, dans le temps.
          </p>
        </div>
        <span className="login-bottom">
          <ShieldCheck size={18} /> Un espace personnel. Des données qui restent les vôtres.
        </span>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">VOTRE ESPACE PERSONNEL</span>
          <h2>Heureux de vous retrouver.</h2>
          <p className="muted">Connectez-vous pour consulter votre portefeuille.</p>
          <form onSubmit={submit}>
            <label>
              Adresse e-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="vous@exemple.fr"
                required
              />
            </label>
            <label>
              Mot de passe
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error && (
              <p role="alert" className="error-note">
                {error}
              </p>
            )}
            <button className="btn primary full" disabled={busy}>
              {busy ? 'Connexion…' : 'Ouvrir mon portefeuille'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="login-help">
            Première utilisation ? Le guide d’installation explique comment créer votre compte
            personnel.
          </p>
        </div>
      </section>
    </main>
  );
}
