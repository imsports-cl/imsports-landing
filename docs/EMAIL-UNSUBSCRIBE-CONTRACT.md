# Contrato de la edge `email-unsubscribe` (1.3.3)

La página `GET /email/unsubscribe` de esta landing **no da de baja**. Solo muestra una confirmación. El botón del formulario hace `POST` a:

```
{NEXT_PUBLIC_SUPABASE_URL}/functions/v1/email-unsubscribe
```

con `Content-Type: application/x-www-form-urlencoded` y el campo `token`.

## Qué tiene que hacer la edge (imsports-app, PR del MVP)

- **GET** `/functions/v1/email-unsubscribe?token=...`: no da de baja. Responde **302** a `https://imsports.app/email/unsubscribe?token=...` (o a la URL pública de la landing). Así un prefetch o un antivirus no cortan el correo.
- **POST**: valida el token HMAC, aplica el opt-out (`email[category]=false`) y redirige a `https://imsports.app/email/unsubscribe?status=ok`. Si el token **ya se usó**, redirige a `?status=used` (no a `ok`) para que esta página muestre «Este enlace ya fue usado…». Si el token es inválido o falla, redirige a `?status=error` (o `?status=error&token=...` para reintentar). También acepta JSON `{ "token": "..." }` y el POST `List-Unsubscribe=One-Click` (RFC 8058).
- El token es la autenticación (`verify_jwt = false`). El POST de un formulario HTML no puede mandar el header `apikey`. La edge (o su gateway) tiene que aceptar ese POST sin `apikey`, o aceptar el token en el cuerpo. No devolver el correo del usuario.
- El token debe ser de un solo uso o vencer en menos de 90 días (en el PR de la app se acorta y se invalida al usarlo).

Este contrato lo implementa el arreglo del PR #33 de `imsports-app`. No desplegar la edge ni aplicar migraciones sin GO de Barham.
