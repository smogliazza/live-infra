# Publicación en Cloudflare Pages y DNS

Cloud Flow Lab es un sitio **100% estático**: no necesita backend, secretos ni variables de entorno en build.

## 1. Build

| Ajuste | Valor |
|---|---|
| Framework preset | Vite (o "None") |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |
| Node.js | 22 (fijado en `.node-version`) |

`vite.config.ts` usa `base: './'`, así que el sitio funciona tanto en la raíz como en un subpath. `public/_headers` añade cabeceras de seguridad (CSP, `X-Content-Type-Options`, etc.).

## 2. Opción A — integración Git (recomendada)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Selecciona este repositorio, rama de producción `main`.
3. Configura el build como en la tabla anterior.
4. Cada push a `main` despliega producción; cada rama/PR obtiene una **preview URL** propia (`<hash>.<proyecto>.pages.dev`). Así el "deploy de preview" no requiere secretos en GitHub Actions.

## 3. Opción B — subida directa con Wrangler

```bash
npm run build
npx wrangler pages deploy dist --project-name cloud-flow-lab
```

Requiere autenticarte con Wrangler en tu máquina (o un API token en CI, guardado como secreto del repositorio; nunca en el código).

## 4. Dominio personalizado y DNS

- **Dominio en Cloudflare DNS** (zona gestionada por Cloudflare): Pages → proyecto → **Custom domains** → añadir `lab.example.com`. Cloudflare crea el registro y emite el certificado.
- **Dominio con DNS externo**: crea un `CNAME lab.example.com → <proyecto>.pages.dev` en tu proveedor DNS y añade el dominio en **Custom domains** para validar. Un dominio apex (`example.com`) normalmente requiere que la zona esté en Cloudflare (CNAME flattening) o soporte ALIAS/ANAME en tu proveedor.
- Ten en cuenta el **TTL**: baja el TTL antes de cambiar registros para que los resolvers recursivos dejen de cachear el valor antiguo antes (exactamente lo que enseña el escenario NXDOMAIN).

## 5. Sobre DuckDNS

**No sirve para apuntar a Cloudflare Pages.** Un dominio personalizado de Pages en un DNS externo necesita un registro **CNAME** hacia `<proyecto>.pages.dev` (y antes hay que dar de alta el dominio en el dashboard de Pages). DuckDNS sólo gestiona registros A/AAAA (y TXT) de sus subdominios, sin CNAME. Un registro A hacia una IP de Cloudflare tampoco funciona: Cloudflare no sabría a qué proyecto corresponde el nombre.

Opciones que sí funcionan:

1. Usar la URL gratuita `https://<proyecto>.pages.dev` (HTTPS incluido).
2. Usar un dominio propio con la zona en Cloudflare (o un subdominio con CNAME en tu proveedor DNS).

Contexto general:

DuckDNS ofrece subdominios dinámicos (`<nombre>.duckdns.org`) que apuntan a una IP. Sirve para exponer un host con IP cambiante, pero:

- No es un DNS autoritativo completo para tu dominio (no gestionas una zona propia ni registros arbitrarios).
- No aporta CDN, WAF ni terminación TLS: eso lo hace Cloudflare (u otro edge) delante.
- Para este proyecto estático, lo natural es usar el subdominio `*.pages.dev` o un dominio propio en Cloudflare.

Verifica las condiciones y limitaciones actuales de cada servicio en su documentación antes de decidir.
