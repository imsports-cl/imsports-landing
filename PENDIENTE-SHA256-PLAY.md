# SHA-256 de la llave de firma de Play — pendiente

`public/.well-known/assetlinks.json` queda con `sha256_cert_fingerprints` vacío a propósito: no se inventó ninguna huella.

Este archivo vive en la raíz del repo y no se publica en `imsports.app`.

Fuentes revisadas el 11-nov-2026 (hora de Chile):

- El AASA usa el Team ID `NSFHLK5399` y el bundle `cl.imsports.app` (coinciden con `app.json`, con ASC app 6761868170 y con la documentación interna del Team ID). Eso cubre iOS.
- El `assetlinks.json` publicado hoy en `app.imsports.app` también tiene el array de huellas vacío.
- No se obtuvo de Google Play Console ni de Play App Signing el certificado con el que se firman las APK que instalan los usuarios. Extraer la firma del AAB de carga daría la *upload key*, que no es la llave de firma de Play si App Signing está activo, y publicarla como si lo fuera rompería App Links en los teléfonos que instalaron desde Play.

Cuando Barham pueda leer en Play Console → Integridad de la app → Explorador de certificados de firma de aplicación el **SHA-256 del certificado de firma de la app**, hay que pegarlo (formato `AA:BB:...`) en `sha256_cert_fingerprints` y volver a desplegar la landing. Hasta entonces, Android no va a verificar el universal link; el scheme `imsports://` y la página de fallback siguen funcionando.
