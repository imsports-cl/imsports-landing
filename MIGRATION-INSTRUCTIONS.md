# Migración a Next.js — instrucciones de aplicación

Este folder contiene la estructura Next.js completa para reemplazar el repo `imsports-cl/imsports-landing` actual (HTML estático).

## Paso 1: Branch nueva en el repo de landing

```bash
cd ~/Documents/Claude/imsports-landing
git checkout -b nextjs-migration
```

## Paso 2: Copiar archivos nuevos encima

```bash
# Desde el repo de imsports-landing
cp -r ~/Documents/Claude/imsports-app/imsports-landing-patch/nextjs/. .

# Verificá que se copiaron
ls -la app/ lib/ package.json next.config.mjs tsconfig.json
```

## Paso 3: Mover el index.html y join.html legacy a public/

**OPCIÓN A (recomendada — mantener el HTML actual sirviéndose intacto):**
- Borrar `app/page.tsx` (el que generé) y `app/join/[code]/page.tsx` (no lo generé pero podrías querer convertir join después)
- Mover los HTML legacy a `public/`:

```bash
mkdir -p public
mv index.html public/index.html  # OJO: Next.js NO sirve public/index.html como /
                                  # Mejor renombrarlo:
mv public/index.html public/legacy-home.html  # accesible en /legacy-home.html
```

PERO: si `index.html` queda en `public/`, Next.js **no lo sirve en `/`** automáticamente (servirá `app/page.tsx`). Para que el HTML original sea la home, tenés que **borrar `app/page.tsx`** Y mover el contenido del index.html legacy a `app/page.tsx` (convertirlo a JSX).

**OPCIÓN B (recomendada — usar el page.tsx nuevo):**
- Dejar `app/page.tsx` (ya tiene una landing decente).
- Borrar el `index.html` legacy.
- Para `join.html`, crear `app/join/[code]/page.tsx` (no incluido — copiá el contenido legacy convertido a JSX).

## Paso 4: Conservar .well-known

```bash
# Asegurate de NO borrar la carpeta .well-known existente.
# Debe quedar en la raíz del repo (NO dentro de public/).
ls -la .well-known/
# Debe mostrar: apple-app-site-association  assetlinks.json
```

Next.js sirve archivos en `.well-known/` automáticamente desde la raíz del proyecto. Si no funciona, ponelos en `public/.well-known/`.

## Paso 5: Variables de entorno

```bash
cp .env.example .env.local
# Editar .env.local y pegar el ANON KEY real de Supabase
```

En Vercel Dashboard → Settings → Environment Variables, agregar:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://whxufmuakpmuyiatfttr.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (el anon key de Supabase Project Settings → API)

Aplicar para **Production**, **Preview** y **Development** environments.

## Paso 6: Instalar deps y testear local

```bash
npm install
npm run dev
```

Abrir:
- http://localhost:3000 → home page
- http://localhost:3000/match/<ANY_REAL_MATCH_ID> → debería mostrar landing + OG meta
- http://localhost:3000/og/match/<ANY_REAL_MATCH_ID>?phase=convocatoria → imagen PNG 1200x630

Si el OG image carga bien (incluso con datos placeholder), todo está OK.

## Paso 7: Validar RLS de Supabase

La página `/match/[id]` y el endpoint `/og/match/[id]` hacen lectura con la **anon key**. Necesitas que las RLS policies permitan leer:
- `matches` (al menos id, phase, date, time, location, scores, mvp_user_id, team names)
- `groups` (al menos id, name, sport)
- `users` (al menos id, display_name para resolver el MVP)

Verificá en Supabase → Authentication → Policies. Si las queries fallan por RLS, agregá una policy permisiva para `SELECT` desde el role `anon` (las columnas que pueden ser públicas).

## Paso 8: Commit y push

```bash
git add -A
git status  # revisar que se vea razonable
git commit -m "feat: migrate to Next.js for dynamic OG meta + Vercel OG images"
git push origin nextjs-migration
```

## Paso 9: Deploy preview en Vercel

Vercel detecta el push y crea un **Preview Deployment** automáticamente (porque pushaste a una branch). Andá al dashboard y abrí el preview URL.

Probá ahí:
1. `<preview-url>/` → debería renderizar la home
2. `<preview-url>/match/<REAL_MATCH_ID>` → cargar e inspeccionar source para ver los `<meta property="og:*">`
3. `<preview-url>/og/match/<REAL_MATCH_ID>` → mostrar la imagen PNG

## Paso 10: Validar OG con Facebook debugger

Cuando el preview URL ande, pegar `<preview-url>/match/REAL_ID` en:
https://developers.facebook.com/tools/debug/

Te muestra exactamente cómo van a ver WhatsApp/FB el link.

## Paso 11: Merge a main

Si todo funciona en preview, hacer merge:
```bash
git checkout main
git merge nextjs-migration
git push
```

Vercel deploya a producción automáticamente. Validá:
```bash
curl -I https://imsports.app/match/REAL_ID
# Debe responder 200, Content-Type: text/html

curl -I https://imsports.app/og/match/REAL_ID
# Debe responder 200, Content-Type: image/png
```

## Riesgos y notas

- **Performance:** la primera generación de cada OG image puede tomar 1-2s. Después se cachea 1h en edge.
- **WhatsApp cache:** WhatsApp cachea agresivamente los previews (~24h). Si cambia la fase, el preview viejo puede quedarse por un rato. El `phase` está en el query string para mitigar, pero para forzar refresh inmediato cambiar la URL (e.g., agregar `?v=...`).
- **Anon key visible:** la `NEXT_PUBLIC_SUPABASE_ANON_KEY` queda visible en el bundle del cliente. Eso es OK (es para eso). Pero por RLS asegurate de que solo expone reads, no writes peligrosos.
- **Universal Links:** iOS sigue resolviendo el AASA. Si Apple lo cachea, puede tomar 24h ver el cambio. Reinstalar la app fuerza refetch.
