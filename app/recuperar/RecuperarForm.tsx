'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, type AuthError } from '@supabase/supabase-js';

/**
 * Recuperar contraseña en imsports.app/recuperar. Acepta tres entradas:
 *  1. ?token_hash=…&type=recovery  (plantilla nueva). El token se verifica recién
 *     cuando la persona toca «Continuar»: un escáner que solo abre la página no lo gasta.
 *  2. Correo + código de 6 dígitos ({{ .Token }} del correo).
 *  3. #access_token=…&refresh_token=…&type=recovery (link estándar de Supabase / flujo implícito).
 * Después de leer la URL la limpiamos con history.replaceState para que el token no
 * quede en el historial ni en el Referer. La página es noindex y no tiene analytics.
 *
 * El cliente usa la anon key (pública por diseño, la misma que trae la app) y no
 * guarda la sesión: al terminar se cierra la sesión local. NO usar lib/supabase.ts
 * aquí (service role, solo servidor).
 */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://whxufmuakpmuyiatfttr.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeHVmbXVha3BtdXlpYXRmdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDgxOTEsImV4cCI6MjA5MDEyNDE5MX0.TB5FXT570-RyM8rW56Gsxj92LoXOhs_DtypZiZP1xiY';

// Mínimo de Supabase Auth en este proyecto (por defecto 6; la app usa el mismo).
const MIN_PASSWORD = 6;

type Mode = 'loading' | 'link' | 'implicit' | 'code' | 'password' | 'done';

function mensajeError(err: AuthError | null, contexto: 'verify' | 'save'): string {
  const code = (err as { code?: string } | null)?.code || '';
  const status = err?.status;
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'Hiciste muchos intentos seguidos. Espera un minuto y vuelve a intentarlo.';
  }
  if (contexto === 'save') {
    if (code === 'weak_password') {
      return `La contraseña es muy débil. Usa al menos ${MIN_PASSWORD} caracteres, mezclando letras y números.`;
    }
    if (code === 'same_password') return 'La nueva contraseña tiene que ser distinta de la anterior.';
    if (code === 'session_expired' || code === 'session_not_found' || status === 401 || status === 403) {
      return 'Pasó demasiado tiempo y el permiso para cambiar la contraseña venció. Pide un nuevo correo desde la app.';
    }
    return 'No pudimos guardar la contraseña. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'El enlace o el código ya se usó o venció. Pide un nuevo correo desde la app (Olvidé mi contraseña) y usa solo el último que te llegue, o ingresa el código de 6 dígitos de ese correo.';
}

export default function RecuperarForm() {
  const supabase = useMemo(
    () =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    [],
  );

  const [mode, setMode] = useState<Mode>('loading');
  const [tokenHash, setTokenHash] = useState('');
  const [implicit, setImplicit] = useState<{ access: string; refresh: string } | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Leer la URL una sola vez y limpiarla de inmediato.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const th = search.get('token_hash') || '';
    const access = hash.get('access_token') || '';
    const refresh = hash.get('refresh_token') || '';
    const hashError = hash.get('error_code') || hash.get('error') || search.get('error_code') || search.get('error');
    const prefillEmail = search.get('email') || '';

    if (window.location.search || window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (prefillEmail) setEmail(prefillEmail);

    if (th) {
      setTokenHash(th);
      setMode('link');
    } else if (access && refresh) {
      setImplicit({ access, refresh });
      setMode('implicit');
    } else {
      if (hashError) setError(mensajeError(null, 'verify'));
      setMode('code');
    }
  }, []);

  const verificar = async () => {
    setBusy(true);
    setError('');
    let err: AuthError | null = null;
    if (mode === 'link') {
      ({ error: err } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }));
    } else if (mode === 'implicit' && implicit) {
      ({ error: err } = await supabase.auth.setSession({
        access_token: implicit.access,
        refresh_token: implicit.refresh,
      }));
    } else {
      ({ error: err } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.replace(/\D/g, ''),
        type: 'recovery',
      }));
    }
    setBusy(false);
    if (err) {
      setError(mensajeError(err, 'verify'));
      // Si el link no sirvió, ofrecemos el camino del código.
      setTokenHash('');
      setImplicit(null);
      setMode('code');
      return;
    }
    setMode('password');
  };

  const guardar = async () => {
    setError('');
    if (pw.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (pw !== pw2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    if (err) {
      setBusy(false);
      setError(mensajeError(err, 'save'));
      return;
    }
    await supabase.auth.signOut({ scope: 'local' });
    setBusy(false);
    setPw('');
    setPw2('');
    setMode('done');
  };

  const codigoListo = email.includes('@') && code.replace(/\D/g, '').length === 6;

  return (
    <main style={s.main}>
      <div style={s.card}>
        <div style={s.logoWrap}>
          <div style={s.badge}>IM</div>
          <div style={s.wordmark}>SPORTS</div>
        </div>

        {mode === 'loading' && <p style={s.p}>Cargando…</p>}

        {(mode === 'link' || mode === 'implicit') && (
          <>
            <h1 style={s.h1}>Recupera tu contraseña</h1>
            <p style={s.p}>Toca el botón para crear una nueva contraseña para tu cuenta de IM SPORTS.</p>
            <button type="button" style={s.btn} disabled={busy} onClick={verificar}>
              {busy ? 'Verificando…' : 'Continuar'}
            </button>
            <button
              type="button"
              style={s.linkBtn}
              onClick={() => {
                setError('');
                setMode('code');
              }}
            >
              Prefiero usar el código del correo
            </button>
          </>
        )}

        {mode === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (codigoListo && !busy) verificar();
            }}
          >
            <h1 style={s.h1}>Recupera tu contraseña</h1>
            <p style={s.p}>Escribe tu correo y el código de 6 dígitos que te enviamos.</p>
            <label style={s.label} htmlFor="email">Correo</label>
            <input
              id="email"
              style={s.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label style={s.label} htmlFor="code">Código</label>
            <input
              id="code"
              style={{ ...s.input, ...s.codeInput }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="submit" style={s.btn} disabled={busy || !codigoListo}>
              {busy ? 'Verificando…' : 'Continuar'}
            </button>
          </form>
        )}

        {mode === 'password' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) guardar();
            }}
          >
            <h1 style={s.h1}>Crea tu nueva contraseña</h1>
            <p style={s.p}>Usa al menos {MIN_PASSWORD} caracteres.</p>
            <label style={s.label} htmlFor="pw">Nueva contraseña</label>
            <input
              id="pw"
              style={s.input}
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <label style={s.label} htmlFor="pw2">Repite la contraseña</label>
            <input
              id="pw2"
              style={s.input}
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
            <button type="submit" style={s.btn} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {mode === 'done' && (
          <>
            <div style={s.check} aria-hidden="true">✓</div>
            <h1 style={s.h1} data-testid="recuperar-ok">¡Listo! Ya puedes entrar a la app con tu nueva contraseña</h1>
            <p style={s.p}>Abre IM SPORTS e inicia sesión con tu correo y la contraseña que acabas de crear.</p>
            <a href="imsports://" style={s.btn}>Abrir IM SPORTS</a>
          </>
        )}

        {error && (
          <p role="alert" data-testid="recuperar-error" style={s.err}>
            {error}
          </p>
        )}

        <div style={s.footer}>
          <div style={s.footerLogo}>
            <span style={{ color: '#00C853' }}>IM</span> SPORTS
          </div>
          <p style={s.footerCopy}>Registra partidos · Compite con tu grupo · Vive el deporte</p>
        </div>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    color: '#1a1a1a',
    background: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  },
  card: { maxWidth: 420, width: '100%', margin: '0 auto', textAlign: 'center', lineHeight: 1.6 },
  logoWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 28 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: '#00E676',
    color: '#0A0A0A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: 19,
    fontFamily: "'Arial Black', Arial, sans-serif",
  },
  wordmark: { fontWeight: 900, fontSize: 24, letterSpacing: 1, fontFamily: "'Arial Black', Arial, sans-serif" },
  h1: { fontSize: 24, fontWeight: 800, margin: '0 0 10px', lineHeight: 1.3 },
  p: { fontSize: 15, color: '#555', margin: '0 0 20px' },
  label: { display: 'block', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#333', margin: '0 0 6px' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 14px',
    fontSize: 16,
    border: '1px solid #D4D4D8',
    borderRadius: 12,
    marginBottom: 14,
    background: '#fff',
    color: '#111',
  },
  codeInput: { letterSpacing: 8, fontSize: 22, textAlign: 'center', fontFamily: "'Courier New', monospace" },
  btn: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '16px 20px',
    fontSize: 16,
    fontWeight: 700,
    color: '#0A0A0A',
    background: '#00E676',
    border: 0,
    borderRadius: 999,
    cursor: 'pointer',
    textDecoration: 'none',
    marginTop: 4,
  },
  linkBtn: {
    marginTop: 14,
    background: 'none',
    border: 0,
    color: '#047857',
    fontSize: 14,
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  check: {
    width: 64,
    height: 64,
    borderRadius: 999,
    background: '#00E676',
    color: '#0A0A0A',
    fontSize: 34,
    fontWeight: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 18px',
  },
  err: {
    marginTop: 16,
    padding: '12px 14px',
    borderRadius: 12,
    background: '#FEF2F2',
    color: '#B91C1C',
    fontSize: 14,
    textAlign: 'left',
  },
  footer: { marginTop: 40, paddingTop: 20, borderTop: '1px solid #eee' },
  footerLogo: { fontSize: 14, fontWeight: 800 },
  footerCopy: { fontSize: 12, color: '#888', margin: '4px 0 0' },
};
