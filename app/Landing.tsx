'use client';

/**
 * Landing page IM SPORTS — restaurada desde el index.html legacy (commit 96f78b8)
 * que se perdió en la migración a Next.js (commit 9bacccb, may 2026).
 *
 * Tema dual (verde/negro nocturno + naranja diurno), animaciones reveal y
 * formulario de email conectado a Supabase (tabla email_signups).
 *
 * Es un Client Component porque usa estado (tema, formulario) y efectos
 * (IntersectionObserver). La metadata vive en page.tsx / layout.tsx (server).
 */
import { useEffect, useState, FormEvent } from 'react';

const SUPABASE_URL = 'https://whxufmuakpmuyiatfttr.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoeHVmbXVha3BtdXlpYXRmdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDgxOTEsImV4cCI6MjA5MDEyNDE5MX0.TB5FXT570-RyM8rW56Gsxj92LoXOhs_DtypZiZP1xiY';

export default function Landing() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Aplicar tema en <html data-theme="...">
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Scroll reveal
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;

    setStatus('loading');
    setMessage('Registrando tu email...');

    try {
      const params = new URLSearchParams(window.location.search);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/email_signups`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          email: value,
          source: 'landing_imsports',
          utm_source: params.get('utm_source') || null,
          utm_medium: params.get('utm_medium') || null,
          utm_campaign: params.get('utm_campaign') || null,
        }),
      });

      if (res.ok) {
        setStatus('success');
        setMessage('¡Listo! Te avisaremos cuando IMSPORTS esté disponible.');
        setEmail('');
      } else {
        const err = await res.json().catch(() => ({} as any));
        if (err.code === '23505') {
          setStatus('success');
          setMessage('¡Ya estás en la lista! Te avisaremos pronto.');
          setEmail('');
        } else {
          throw new Error(err.message || 'Error al registrar');
        }
      }
    } catch (error) {
      setStatus('error');
      setMessage('Hubo un error. Intenta de nuevo o escríbenos a hola@imsports.cl');
      // eslint-disable-next-line no-console
      console.error('Signup error:', error);
    }
  }

  return (
    <>
      {/* NAV */}
      <nav>
        <div className="nav-inner">
          <a href="#" className="logo">
            <div className="logo-icon">IM</div>
            <div className="logo-text">SPORTS</div>
          </a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">Cómo funciona</a>
            <a href="#join">Únete</a>
            <div className="theme-toggle-wrapper">
              <div
                className="theme-toggle"
                onClick={toggleTheme}
                title="Cambiar tema"
                role="button"
                aria-label="Cambiar tema"
              />
            </div>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="dot" />
            Disponible en App Store · Pronto en Google Play
          </div>
          <h1>
            Tu grupo deportivo
            <br />
            <span className="accent">vive, compite y crece</span>
          </h1>
          <p>
            IMSPORTS es la plataforma donde tu grupo lleva su historial, estadísticas, rankings y
            convocatorias. Todo en un solo lugar.
          </p>
          <div className="hero-cta">
            <a href="https://apps.apple.com/app/id6761868170" className="btn-primary">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
              Descargar en App Store
            </a>
            <a href="#features" className="btn-secondary">
              Conoce más
            </a>
          </div>
        </div>
      </section>

      {/* STATS BAR */}
      <section className="stats-bar">
        <div className="stats-grid">
          <div className="stat-item reveal">
            <div className="stat-number">83+</div>
            <div className="stat-label">Partidos registrados</div>
          </div>
          <div className="stat-item reveal">
            <div className="stat-number">32</div>
            <div className="stat-label">Jugadores activos</div>
          </div>
          <div className="stat-item reveal">
            <div className="stat-number">2,237</div>
            <div className="stat-label">Participaciones</div>
          </div>
          <div className="stat-item reveal">
            <div className="stat-number">100%</div>
            <div className="stat-label">Stats verificadas</div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features" id="features">
        <div className="section-header reveal">
          <div className="tag">Features</div>
          <h2>Todo lo que tu grupo necesita</h2>
          <p>Dejá el Excel y el grupo de WhatsApp. IMSPORTS centraliza todo.</p>
        </div>
        <div className="features-grid">
          <div className="feature-card reveal">
            <div className="feature-icon">📊</div>
            <h3>Estadísticas automáticas</h3>
            <p>
              Goles, asistencias, MVPs, victorias y derrotas. Todo se calcula solo después de cada
              partido.
            </p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-icon">🏆</div>
            <h3>Rankings y ligas</h3>
            <p>
              Rankings en tiempo real dentro de tu grupo. ¿Quién es el goleador? ¿Quién tiene más
              MVPs? Todo visible.
            </p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-icon">📢</div>
            <h3>Convocatoria inteligente</h3>
            <p>
              Envía la convocatoria, confirma asistencia, arma los equipos y define titulares. Todo
              desde la app.
            </p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-icon">🔄</div>
            <h3>Partidos recurrentes</h3>
            <p>
              Configura tu pichanga semanal una vez. IMSPORTS crea el próximo partido
              automáticamente al cerrar el anterior.
            </p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-icon">⚡</div>
            <h3>Historial completo</h3>
            <p>
              Cada partido queda registrado con equipos, resultado, goleadores y MVP. Tu grupo tiene
              memoria.
            </p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-icon">👥</div>
            <h3>Gestión de grupo</h3>
            <p>
              Invita miembros, asigna roles de admin, y gestiona tu grupo deportivo como un
              verdadero equipo.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how-it-works" id="how">
        <div className="section-header reveal">
          <div className="tag">Cómo funciona</div>
          <h2>3 pasos, cero complicaciones</h2>
        </div>
        <div className="steps">
          <div className="step reveal">
            <div className="step-number">1</div>
            <div>
              <h3>Crea tu grupo</h3>
              <p>
                Elige el deporte, ponle nombre a tu grupo e invita a tus amigos con un link. En 30
                segundos están todos adentro.
              </p>
            </div>
          </div>
          <div className="step reveal">
            <div className="step-number">2</div>
            <div>
              <h3>Juega y registra</h3>
              <p>
                Después de cada partido, registra el resultado, los equipos y elige al MVP. Las
                stats se actualizan solas.
              </p>
            </div>
          </div>
          <div className="step reveal">
            <div className="step-number">3</div>
            <div>
              <h3>Compite y presume</h3>
              <p>
                Mira los rankings, desafía al goleador, comparte tus stats en redes. Tu grupo
                deportivo ahora tiene historia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="social-proof">
        <div className="section-header reveal">
          <div className="tag">Beta testers</div>
          <h2>Lo que dicen nuestros primeros usuarios</h2>
        </div>
        <div className="testimonials-grid">
          <div className="testimonial reveal">
            <div className="testimonial-quote">
              &quot;Por fin dejamos de pelear por quién lleva el conteo de goles. Ahora está todo en
              la app y nadie puede alegar.&quot;
            </div>
            <div className="testimonial-author">
              <div className="testimonial-avatar">⚽</div>
              <div>
                <div className="testimonial-name">Grupo Galletas+Ibáñez</div>
                <div className="testimonial-role">32 jugadores · 83 partidos</div>
              </div>
            </div>
          </div>
          <div className="testimonial reveal">
            <div className="testimonial-quote">
              &quot;La convocatoria es brutal. Antes mandaba el mensaje al WhatsApp y nadie
              respondía. Ahora con un toque confirman o rechazan.&quot;
            </div>
            <div className="testimonial-author">
              <div className="testimonial-avatar">🏟️</div>
              <div>
                <div className="testimonial-name">Spid</div>
                <div className="testimonial-role">Admin · 36 partidos · 54 goles</div>
              </div>
            </div>
          </div>
          <div className="testimonial reveal">
            <div className="testimonial-quote">
              &quot;Lo mejor es ver tu progreso. Saber que vas 28 ganados y 19 perdidos te motiva a
              ir al siguiente partido.&quot;
            </div>
            <div className="testimonial-author">
              <div className="testimonial-avatar">🎯</div>
              <div>
                <div className="testimonial-name">Robert</div>
                <div className="testimonial-role">66 goles · 5 MVPs</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section" id="join">
        <div className="cta-content">
          <h2>Sé de los primeros</h2>
          <p>Déjanos tu email y te avisamos de novedades y nuevas funciones de IMSPORTS.</p>
          <form className="email-form" id="signup-form" onSubmit={handleSubmit}>
            <input
              type="email"
              id="email-input"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" id="submit-btn" disabled={status === 'loading'}>
              {status === 'loading' ? 'Enviando...' : 'Quiero acceso'}
            </button>
          </form>
          <div className={`form-message ${status === 'idle' ? '' : status}`}>{message}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
            Sin spam. Solo te avisamos cuando esté listo.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-inner">
          <div className="footer-text">2026 IMSPORTS. Hecho en Chile.</div>
          <div className="footer-links">
            <a href="#">Instagram</a>
            <a href="#">TikTok</a>
            <a href="mailto:hola@imsports.cl">Contacto</a>
          </div>
        </div>
      </footer>
    </>
  );
}
