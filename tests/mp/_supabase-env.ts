/** El cliente de Supabase se crea al importar. Estos tests no salen a la red. */
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy';
