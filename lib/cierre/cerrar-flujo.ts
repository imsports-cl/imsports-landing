/**
 * Cerrar y copiar: si el cierre falla, no se copia.
 * Si el partido ya tenía match_closed, no se vuelve a escribir: se recalcula y se copia.
 */
export async function ejecutarCerrarYCopiar(op: {
  /** created_at del match_closed ya existente, o null si todavía no se cerró. */
  cierreActual: string | null;
  cerrar: () => Promise<string>;
  mensajeConCierre: (en: string) => string | Promise<string>;
  copiar: (texto: string) => Promise<void>;
}): Promise<{ texto: string; ya_existia: boolean }> {
  const ya_existia = Boolean(op.cierreActual);
  const en = op.cierreActual ?? await op.cerrar();
  const texto = await op.mensajeConCierre(en);
  await op.copiar(texto);
  return { texto, ya_existia };
}
