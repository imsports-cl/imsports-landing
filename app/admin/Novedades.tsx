'use client';
/**
 * Pestaña "Novedades" del panel admin: noticias del feed de la app y
 * auspiciadores. Al publicar una noticia, la base manda push a todos
 * (trigger tr_news_notify) — el panel solo crea la fila.
 */
import { useEffect, useState } from 'react';

const S = {
  bg: '#0A0A0A', card: '#161616', border: '#2A2A2A',
  accent: '#00E676', text: '#FFFFFF', dim: '#9A9A9A', warn: '#FF6B2B',
};

interface Noticia {
  id: string; title: string; body: string | null; image_url: string | null;
  link_url: string | null; link_label: string | null; pinned: boolean;
  is_active: boolean; notify: boolean; published_at: string; notified_at: string | null;
  created_by: string | null;
}
interface Auspiciador {
  id: string; name: string; tagline: string | null; logo_url: string | null;
  link_url: string | null; is_active: boolean; sort_order: number;
  starts_at: string | null; ends_at: string | null;
}

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0F0F0F', color: S.text,
  border: `1px solid ${S.border}`, borderRadius: 8, padding: '9px 11px', fontSize: 14, marginBottom: 8,
};
const btn = (primary = false): React.CSSProperties => ({
  border: `1px solid ${primary ? S.accent : S.border}`, background: primary ? 'rgba(0,230,118,0.12)' : 'transparent',
  color: primary ? S.accent : S.text, borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 13, fontWeight: primary ? 700 : 400,
});
const fecha = (iso: string) => new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Novedades({ token }: { token: string }) {
  const [noticias, setNoticias] = useState<Noticia[] | null>(null);
  const [ausp, setAusp] = useState<Auspiciador[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [n, setN] = useState({ title: '', body: '', image_url: '', link_url: '', link_label: '', pinned: false, notify: true });
  const [a, setA] = useState({ name: '', tagline: '', logo_url: '', link_url: '', sort_order: 0, starts_at: '', ends_at: '' });

  const cargar = async () => {
    const r = await fetch('/admin/api/novedades', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const j = await r.json(); setNoticias(j.noticias); setAusp(j.auspiciadores); }
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [token]);

  const post = async (payload: Record<string, unknown>, clave: string, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return false;
    setBusy(clave);
    try {
      const r = await fetch('/admin/api/novedades', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error ?? 'No se pudo completar la acción'); return false; }
      await cargar();
      return true;
    } finally { setBusy(null); }
  };

  const publicar = async () => {
    if (!n.title.trim()) { alert('Falta el título'); return; }
    const msg = n.notify
      ? `Se publica "${n.title}" y se manda una notificación push a todos los usuarios. ¿Continuar?`
      : `Se publica "${n.title}" sin notificación. ¿Continuar?`;
    if (await post({ action: 'news_create', ...n }, 'nueva', msg)) {
      setN({ title: '', body: '', image_url: '', link_url: '', link_label: '', pinned: false, notify: true });
    }
  };

  const crearAusp = async () => {
    if (!a.name.trim()) { alert('Falta el nombre'); return; }
    if (await post({ action: 'sponsor_create', ...a }, 'nuevoausp')) {
      setA({ name: '', tagline: '', logo_url: '', link_url: '', sort_order: 0, starts_at: '', ends_at: '' });
    }
  };

  const box: React.CSSProperties = { background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: 18, marginBottom: 18 };

  return (
    <>
      <section style={box}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>📣 Nueva noticia</h3>
        <p style={{ color: S.dim, fontSize: 13, margin: '0 0 12px' }}>
          Aparece en el inicio de la app para todos. Con "Notificar" marcado, al publicar se manda un push a todos los usuarios.
        </p>
        <input style={input} placeholder="Título *" value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} />
        <textarea style={{ ...input, minHeight: 90, fontFamily: 'inherit' }} placeholder="Texto de la noticia" value={n.body} onChange={(e) => setN({ ...n, body: e.target.value })} />
        <input style={input} placeholder="URL de imagen (opcional)" value={n.image_url} onChange={(e) => setN({ ...n, image_url: e.target.value })} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={input} placeholder="Link (opcional, https://…)" value={n.link_url} onChange={(e) => setN({ ...n, link_url: e.target.value })} />
          <input style={{ ...input, maxWidth: 200 }} placeholder="Texto del botón" value={n.link_label} onChange={(e) => setN({ ...n, link_label: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
          <label><input type="checkbox" checked={n.notify} onChange={(e) => setN({ ...n, notify: e.target.checked })} /> Notificar a todos (push)</label>
          <label><input type="checkbox" checked={n.pinned} onChange={(e) => setN({ ...n, pinned: e.target.checked })} /> Fijar arriba</label>
        </div>
        <button style={btn(true)} disabled={busy === 'nueva'} onClick={publicar}>{busy === 'nueva' ? 'Publicando…' : 'Publicar'}</button>
      </section>

      <section style={box}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Noticias publicadas {noticias ? `(${noticias.length})` : ''}</h3>
        {!noticias ? <p style={{ color: S.dim }}>Cargando…</p> : noticias.length === 0 ? <p style={{ color: S.dim }}>Aún no hay noticias.</p> : (
          noticias.map((x) => (
            <div key={x.id} style={{ border: `1px solid ${S.border}`, borderRadius: 12, padding: 14, marginBottom: 10, background: '#0F0F0F', opacity: x.is_active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{x.pinned ? '📌 ' : ''}{x.title}{!x.is_active ? <span style={{ color: S.dim, fontWeight: 400 }}> · oculta</span> : null}</strong>
                <span style={{ color: S.dim, fontSize: 12 }}>{fecha(x.published_at)}{x.created_by ? ` · ${x.created_by}` : ''}{x.notified_at ? ' · 🔔 enviada' : ''}</span>
              </div>
              {x.body && <p style={{ margin: '8px 0', fontSize: 13, color: S.dim, whiteSpace: 'pre-wrap' }}>{x.body}</p>}
              {x.link_url && <p style={{ margin: '4px 0 8px', fontSize: 12 }}><a href={x.link_url} target="_blank" rel="noreferrer" style={{ color: S.accent }}>{x.link_label || x.link_url}</a></p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button style={btn()} disabled={busy === x.id} onClick={() => post({ action: 'news_update', id: x.id, is_active: !x.is_active }, x.id)}>{x.is_active ? 'Ocultar' : 'Mostrar'}</button>
                <button style={btn()} disabled={busy === x.id} onClick={() => post({ action: 'news_update', id: x.id, pinned: !x.pinned }, x.id)}>{x.pinned ? 'Desfijar' : 'Fijar arriba'}</button>
                <button style={{ ...btn(), color: S.warn, borderColor: S.warn }} disabled={busy === x.id} onClick={() => post({ action: 'news_delete', id: x.id }, x.id, `¿Eliminar "${x.title}"? No se puede deshacer.`)}>Eliminar</button>
              </div>
            </div>
          ))
        )}
      </section>

      <section style={box}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>🤝 Nuevo auspiciador</h3>
        <p style={{ color: S.dim, fontSize: 13, margin: '0 0 12px' }}>
          Aparece como burbuja entre las noticias del inicio. El logo es una URL de imagen (ideal cuadrada, PNG con fondo transparente).
        </p>
        <input style={input} placeholder="Nombre *" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
        <input style={input} placeholder="Frase corta (ej. 'Auspiciador oficial de la pichanga')" value={a.tagline} onChange={(e) => setA({ ...a, tagline: e.target.value })} />
        <input style={input} placeholder="URL del logo" value={a.logo_url} onChange={(e) => setA({ ...a, logo_url: e.target.value })} />
        <input style={input} placeholder="Link (opcional, https://…)" value={a.link_url} onChange={(e) => setA({ ...a, link_url: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: S.dim }}>Desde<input style={input} type="date" value={a.starts_at} onChange={(e) => setA({ ...a, starts_at: e.target.value })} /></label>
          <label style={{ fontSize: 12, color: S.dim }}>Hasta<input style={input} type="date" value={a.ends_at} onChange={(e) => setA({ ...a, ends_at: e.target.value })} /></label>
          <label style={{ fontSize: 12, color: S.dim }}>Orden<input style={{ ...input, width: 90 }} type="number" value={a.sort_order} onChange={(e) => setA({ ...a, sort_order: Number(e.target.value) })} /></label>
        </div>
        <button style={btn(true)} disabled={busy === 'nuevoausp'} onClick={crearAusp}>{busy === 'nuevoausp' ? 'Guardando…' : 'Agregar auspiciador'}</button>
      </section>

      <section style={box}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Auspiciadores {ausp ? `(${ausp.length})` : ''}</h3>
        {!ausp ? <p style={{ color: S.dim }}>Cargando…</p> : ausp.length === 0 ? <p style={{ color: S.dim }}>Aún no hay auspiciadores.</p> : (
          ausp.map((x) => (
            <div key={x.id} style={{ display: 'flex', gap: 14, alignItems: 'center', border: `1px solid ${S.border}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#0F0F0F', opacity: x.is_active ? 1 : 0.55, flexWrap: 'wrap' }}>
              {x.logo_url ? <img src={x.logo_url} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'contain', background: '#fff' }} /> : <div style={{ width: 48, height: 48, borderRadius: 10, background: S.border }} />}
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong style={{ fontSize: 14 }}>{x.name}{!x.is_active ? <span style={{ color: S.dim, fontWeight: 400 }}> · oculto</span> : null}</strong>
                {x.tagline && <div style={{ fontSize: 13, color: S.dim }}>{x.tagline}</div>}
                <div style={{ fontSize: 12, color: S.dim }}>
                  {x.link_url ? <a href={x.link_url} target="_blank" rel="noreferrer" style={{ color: S.accent }}>{x.link_url}</a> : 'sin link'}
                  {x.starts_at || x.ends_at ? ` · ${x.starts_at ?? '…'} → ${x.ends_at ?? '…'}` : ''} · orden {x.sort_order}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn()} disabled={busy === x.id} onClick={() => post({ action: 'sponsor_update', id: x.id, is_active: !x.is_active }, x.id)}>{x.is_active ? 'Ocultar' : 'Mostrar'}</button>
                <button style={{ ...btn(), color: S.warn, borderColor: S.warn }} disabled={busy === x.id} onClick={() => post({ action: 'sponsor_delete', id: x.id }, x.id, `¿Eliminar a ${x.name}?`)}>Eliminar</button>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}
