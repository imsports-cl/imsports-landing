/**
 * Red de seguridad para los tests: ninguna llamada de red real.
 * Si algo intenta salir (Supabase prod, MercadoPago real), el test revienta.
 */
const real = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  throw new Error(`fetch bloqueado en tests: ${String(input).split('?')[0]}`);
}) as typeof fetch;
delete process.env.MP_ACCESS_TOKEN;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
export const fetchReal = real;
