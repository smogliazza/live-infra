# Guía de contribución

¡Gracias por querer mejorar Cloud Flow Lab! Es un proyecto educativo: la **exactitud técnica** importa tanto como el código.

## Primeros pasos

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # tests del motor (Vitest)
npm run lint && npm run typecheck
npm run test:e2e   # Playwright (construye y sirve la app)
```

## Qué contribuir

- **Escenarios y fallos nuevos** — ver [docs/adding-providers-and-scenarios.md](docs/adding-providers-and-scenarios.md).
- **Perfiles de proveedor** (Azure, GCP, DigitalOcean, OCI) — ver [ROADMAP.md](ROADMAP.md).
- **Correcciones de contenido**: si un nombre, límite o comportamiento de un servicio es incorrecto u obsoleto, abre un issue con el enlace a la documentación oficial.

## Reglas

1. El motor (`src/engine`) no depende de React ni del catálogo. La UI no inventa comportamiento: todo sale de eventos del motor.
2. Mantén el determinismo: nada de `Math.random()` ni `Date.now()` en el motor; usa `engine.rng`.
3. Todo dato es sintético y se marca como tal. Las configuraciones de ejemplo son **ilustrativas**.
4. Enlaza documentación oficial al afirmar capacidades de un servicio; no asumas equivalencias por nombre.
5. Añade tests para cada flujo o fallo nuevo. No desactives tests para conseguir verde.
6. Commits descriptivos; PRs pequeños; actualiza `CHANGELOG.md` en `[Unreleased]`.

## Código de conducta

Este proyecto sigue el [Código de conducta](CODE_OF_CONDUCT.md).
