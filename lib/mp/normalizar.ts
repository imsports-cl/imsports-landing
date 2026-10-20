/**
 * Normalización de nombres y correos para cruzar pagos de MercadoPago con
 * jugadores. Sin acentos, minúsculas y sin signos. Módulo puro (sin red ni BD).
 */
import { createHash } from 'node:crypto';

/** "Gonzalo  GÁLVEZ-Díaz" → "gonzalo galvez diaz" */
export function normalizarNombre(s?: string | null): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens de un nombre (descarta iniciales sueltas: "l", "j"). */
export function tokensNombre(s?: string | null): string[] {
  return normalizarNombre(s).split(' ').filter((t) => t.length >= 2);
}

export function normalizarEmail(s?: string | null): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/** Hash del correo normalizado. Es lo único que se guarda del correo del pagador. */
export function hashEmail(s?: string | null): string | null {
  const e = normalizarEmail(s);
  if (!e || !e.includes('@')) return null;
  return createHash('sha256').update(e).digest('hex');
}

/** Parte local del correo, solo letras: "juan.perez89@x" → "juanperez" */
export function localEmailLetras(s?: string | null): string {
  const local = normalizarEmail(s).split('@')[0] || '';
  return local.replace(/[^a-z]/g, '');
}

/** Tokens de la parte local: "juan.soto1989@x" → ["juan", "soto"] */
export function tokensEmail(s?: string | null): string[] {
  const local = normalizarEmail(s).split('@')[0] || '';
  return local.split(/[^a-z]+/).filter((t) => t.length >= 2);
}
