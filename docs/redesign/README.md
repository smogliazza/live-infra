# Rediseño UI/UX — "Living Infrastructure" (v0.6.0)

Rediseño integral de la capa de presentación de Cloud Flow Lab, implementado sobre el proyecto existente según `Cloud_Flow_Lab_Prompt_Redisenio_Definitivo.md`.

## 1. Resumen ejecutivo

- **Identidad visual propia** ("Living Infrastructure") con dos temas completos y de calidad equivalente: **Dark Graphite** (por defecto) y **Light Technical**. Light Technical tiene su propia paleta; no es una inversión del oscuro. El cambio de tema persiste entre sesiones y respeta `prefers-color-scheme` cuando no hay preferencia guardada.
- **Entorno equilibrado:** canvas ≈ 60 %, inspector ≈ 40 % y consola inferior ≈ 25 % de la altura. Inspector y consola se pueden redimensionar, colapsar y expandir, y los tamaños persisten.
- **Canvas 2D por capas:** seis capas de lectura (Cloud, Networking, Kubernetes, Aplicación, Delivery, Observabilidad) derivadas del modelo existente. Ocultar una capa atenúa sus elementos sin borrar relaciones ni afectar a la simulación.
- **Nodos y conexiones legibles:**
  - Nodos: icono técnico por intención arquitectónica, estado con icono + texto, señal de actividad y pertenencia a capas.
  - Conexiones: clasificadas por tipo real (norte-sur, este-oeste, delivery, control plane/GitOps, IaC), con dirección, resaltado, etiqueta contextual y selección.
- **Inspector técnico** con secciones Overview / Arquitectura / Configuración / Observabilidad / Troubleshooting, que solo aparecen si hay datos. Vistas nuevas para **conexión** y **evento** seleccionados.
- **Interacción híbrida:** los nodos se pueden arrastrar. La posición es estado visual, separado del escenario, y se restaura con un clic.
- **Animación significativa** derivada del motor: pulsos, anillo de actividad, aparición y terminación de Pods. Las animaciones de bucle se congelan en pausa y se desactivan con movimiento reducido.
- **Motor, modelo, escenarios y catálogo sin cambios** (sección 9).

## 2. Capturas antes / después

Mismo guion de interacción antes y después (`1600×1000`).

| Vista | Antes | Después · Dark Graphite | Después · Light Technical |
|---|---|---|---|
| Request + inspector | ![](before-1-request.webp) | ![](after-dark-1-request.webp) | ![](after-light-1-request.webp) |
| Release en curso | ![](before-2-release.webp) | ![](after-dark-2-release.webp) | ![](after-light-2-release.webp) |
| Troubleshooting (traza 504) | ![](before-3-traces.webp) | ![](after-dark-3-traces.webp) | ![](after-light-3-traces.webp) |
| Comparación AWS vs Azure | ![](before-4-compare.webp) | ![](after-dark-4-compare.webp) | ![](after-light-4-compare.webp) |

Vistas nuevas:

| Vista | Dark Graphite | Light Technical |
|---|---|---|
| Conexión seleccionada + leyenda | ![](after-dark-5-edge-legend.webp) | ![](after-light-5-edge-legend.webp) |
| Evento seleccionado (IDs, payload, causalidad) | ![](after-dark-6-event.webp) | ![](after-light-6-event.webp) |
| DigitalOcean · Troubleshooting del Gateway | ![](after-dark-7-do-troubleshooting.webp) | ![](after-light-7-do-troubleshooting.webp) |

## 3. Decisiones visuales

**Tokens centralizados** (`src/styles/tokens.css`). Los componentes solo usan tokens semánticos.

| Token | Dark Graphite | Light Technical |
|---|---|---|
| Background | `#151A22` | `#EEF1F5` |
| Canvas | `#11161D` | `#F8F9FB` |
| Panel | `#1D2632` | `#FFFFFF` |
| Elevated | `#263342` | `#F3F5F8` |
| Hover | `#304154` | `#E8ECF2` |
| Border | `#3A4A5D` | `#C3CCD8` |
| Texto | `#E6EDF5` / `#A1B1C3` / `#8B9CB1` | `#16202B` / `#3F4F63` / `#5D6C80` |

**Color semántico** (misma semántica en ambos temas; tonos de Light oscurecidos para contraste):

| Concepto | Dark | Light |
|---|---|---|
| Networking / interacción | `#58A6FF` | `#1A63BF` |
| Requests / tráfico | `#42C8D5` | `#0A6F79` |
| Healthy / éxito | `#36C98F` | `#12704F` |
| Build / deployment / IaC | `#F0A44B` | `#955107` |
| Error / fallo | `#F47C85` | `#C42F3C` |
| Control plane / GitOps | `#A78BFA` | `#6B4FD1` |
| Warning / latencia | `#EBCB72` | `#775C00` |

Ajustes respecto a los valores iniciales del brief, por contraste:
- Muted oscuro: `#71849A` → `#8B9CB1`.
- Rojo oscuro: `#F16C75` → `#F47C85`.

**Contraste comprobado:** 80 pares texto/estado contra fondo, canvas, panel y superficie elevada, en ambos temas. Todos cumplen WCAG AA: ≥ 4,5:1 para texto sobre paneles y ≥ 3:1 para elementos gráficos sobre fondo y canvas.

**Otras decisiones**
- **Estados:** nunca solo con color. Cada estado tiene icono + texto (en ejecución, correcto, aviso, reintentando, fallido, bloqueado, revirtiendo, inactivo), y los nodos fallidos llevan además borde y fondo diferenciados.
- **Conexiones:**
  - Norte-sur: línea continua gruesa, cian.
  - Este-oeste: línea continua, azul.
  - Delivery: guiones, naranja.
  - Control plane / GitOps: punteado, violeta.
  - IaC: punteado fino, naranja.
  - La flecha indica quién inicia; las respuestas y los pulls viajan en sentido inverso.
- **Tipografía:** sans-serif del sistema para la interfaz; monoespaciada para logs, IDs, protocolos, puertos y código. No se descargan fuentes web, por la CSP `'self'` y por el tamaño.
- **Iconografía:** `lucide-react`, un icono por intención arquitectónica y por estado. Sustituye los glifos y emojis anteriores. No se usan logotipos de marcas.

## 4. Componentes

**Nuevos**
- `src/styles/tokens.css`: design tokens de ambos temas.
- `src/ui/state/preferences.ts`: persistencia de tema y layout en localStorage (presentación).
- `src/ui/layers.ts`: capas conceptuales derivadas del modelo.
- `src/ui/edgeClass.ts`: clasificación visual de conexiones.
- `src/ui/components/icons.tsx`: iconografía por intención y por estado.

**Modificados**
- `src/ui/components/FlowCanvas.tsx`: nodos, conexiones, capas, selección de edges, vecinos, arrastre, leyenda, minimapa bajo demanda, navegación.
- `src/ui/components/Inspector.tsx`: secciones; vistas de nodo, conexión, evento y escenario.
- `src/ui/components/Header.tsx`: grupos Contexto / Simulación / Acciones / Vista; menú de capas; tema.
- `src/ui/App.tsx`: layout equilibrado, splitter del inspector, rail de inspector colapsado, atajos `c` y `f`.
- `src/ui/components/Console.tsx`: iconos de pestaña.
- `src/ui/state/store.ts`: estado de presentación (tema, foco del inspector, conexión seleccionada, capas, posiciones, paneles).
- `src/styles/theme.css`: reescrita sobre tokens.
- `e2e/app.spec.ts`: actualización de un test y 8 tests nuevos.
- `tsconfig.node.json`: tipos DOM para `page.evaluate` en E2E.

## 5. Dependencias agregadas

| Paquete | Motivo |
|---|---|
| `lucide-react` | Iconografía técnica coherente (MIT). Se importa icono a icono: el bundle solo incluye los ~45 usados. Coste del rediseño completo en el bundle principal: ~56 KB sin comprimir. |

## 6. Tests ejecutados

| Suite | Antes | Después |
|---|---|---|
| `npm run lint` | limpio | limpio |
| `npm run typecheck` | limpio | limpio |
| `npm test` (Vitest, motor) | 113 ✔ | 113 ✔ |
| `npm run test:e2e` (Playwright) | 11 ✔ | 19 ✔ |
| Repetición ×3 de los E2E sensibles al tiempo | — | 9 ✔ |
| Build de producción con la CSP de `public/_headers` | sin violaciones | sin violaciones |

**Cambio en un test existente:** "seleccionar un nodo abre el inspector" ahora navega a las secciones *Configuración* y *Troubleshooting* para comprobar la configuración ilustrativa y los fallos comunes. El contenido es el mismo; solo cambia dónde se muestra.

**E2E nuevos:**
- Persistencia del tema.
- Inspector de conexión.
- Inspector de evento.
- Capas: atenuación, capa de observabilidad deshabilitada y simulación intacta.
- Arrastre y restauración del layout.
- Colapsar y reabrir el inspector.
- Leyenda y minimapa.
- Movimiento reducido.

## 7. Matriz de regresión

| Funcionalidad | Resultado | Cómo se comprobó |
|---|---|---|
| Cambio de proveedor y escenario | ✔ | E2E Azure, GCP y DigitalOcean |
| Arquitecturas individuales y comparación | ✔ | E2E comparación (503 vs 502) y capturas AWS vs Azure y AWS vs GCP |
| Zoom, pan y fit to view | ✔ | Controles de React Flow intactos; nuevo atajo `f` y botón de centrar (`c`) |
| Selección de nodos | ✔ | E2E de regresión React #185 (5 clics + teclado) |
| Selección de conexiones | ✔ nuevo | E2E inspector de conexión |
| Activar/desactivar capas | ✔ nuevo | E2E capas |
| Reorganización y restauración del layout | ✔ nuevo | E2E arrastre: la topología y el edge `orders → sqs` se conservan |
| Requests, recorridos, branching y concurrencia | ✔ | Tests del motor (sin cambios) + E2E request y traza |
| Respuestas y errores | ✔ | E2E WAF 403, LB 502/503, Envoy 503 |
| Deployment, CI/CD y GitOps/Argo CD | ✔ | E2E release completa + tests del motor |
| Terraform | ✔ | Tests del motor + captura (plan con drift esperando aprobación) |
| Kubernetes y rollout | ✔ | Tests del motor + capturas de release en curso |
| Escalado (autoscaling) | N/A | No existe en el motor |
| Troubleshooting y fallos | ✔ | E2E fallos + pestaña Troubleshooting del inspector |
| Logs, métricas y trazas | ✔ | E2E consola (scroll), traza y evento |
| Correlación entre eventos y canvas | ✔ | Seleccionar un evento resalta su componente y su conexión; una traza, su recorrido |
| Play, pause, step, restart y velocidad | ✔ | E2E pausa/paso; controles con los mismos callbacks |
| Cambio de tema y persistencia | ✔ nuevo | E2E tema |
| Movimiento reducido | ✔ | E2E movimiento reducido |

## 8. Separación motor ↔ presentación

- La capa visual consume `engine.transfers`, `engine.runtime`, `engine.workloads`, `nodeVisualStatus`, `computeMetrics`, `buildTrace` y el event log. No hay timers propios de la simulación: la única fuente de tiempo sigue siendo el reloj virtual.
- Las posiciones arrastradas, las capas ocultas, el tema y los tamaños de los paneles se guardan en `localStorage` (`cfl.theme`, `cfl.layout.v1`), separados del escenario.
- La clasificación de conexiones y las capas se **derivan** de campos que ya existían (`EdgeDef.traffic`, `NodeDef.intent`, `CatalogService.layer`, `Boundary.kind`). No se añadieron componentes ni datos.

## 9. Confirmación: motor y flujos sin modificar

Verificado con `git diff origin/main -- src/engine src/model src/scenarios src/catalog`: **sin cambios**. No se modificaron:
- el motor, el reloj ni el scheduler;
- los flujos de request, delivery e IaC;
- las topologías, el catálogo ni los contratos;
- la generación de eventos, métricas y trazas;
- los fallos ni la comparación.

## 10. Defectos o comportamientos preexistentes (documentados, no corregidos)

Son comportamientos del motor o de vistas anteriores que el rediseño hace más visibles. No se tocaron porque quedan fuera del alcance de presentación.

1. **Métricas de request incluyen el smoke test:** las requests sintéticas del smoke test de una release cuentan en RPS y error rate.
2. **Desvanecimiento de estados:** el motor devuelve `fallido`/`aviso` durante 400 ms virtuales y `correcto` durante 30–60 ms antes de volver a `inactivo`. El canvas lo refleja tal cual.
3. **CPU y memoria** siguen siendo un modelo sintético en función de la carga activa (ya etiquetado así en la consola y el inspector).
4. **Comparación salto a salto:** si un componente tiene varios spans (reintentos, base de datos llamada por dos servicios), la tabla suma sus duraciones.
5. **Paso atrás** no está disponible en modo comparación.
6. **Pulsos en edges avanzados:** los pulsos de delivery que recorren conexiones de "detalle avanzado" (watch del kubelet, image pull, APIs de Terraform) no se ven si ese detalle está desactivado.

### Corrección posterior detectada por CI

En el runner de GitHub Actions (viewport por defecto de 1280 px y fuentes más anchas), la leyenda abierta, anclada abajo a la derecha con hasta 760 px de ancho, se superponía a los controles del canvas y bloqueaba sus clics. Ahora la leyenda se ancla arriba a la derecha, su ancho se limita al espacio que deja libre la columna de controles y, si no cabe, reparte sus columnas y hace scroll. El E2E simula texto más ancho y comprueba por geometría que no haya solape, así no depende de las fuentes del entorno.

## 11. Limitaciones y deuda técnica

- **Capa de observabilidad:** ningún escenario tiene componentes de observabilidad en el modelo, así que la capa aparece deshabilitada. La observabilidad vive en la consola.
- **Pods:** se dibujan dentro de su Deployment, como en el modelo. No son nodos independientes del canvas.
- **Boundaries:** no son arrastrables. Arrastrar un nodo fuera de su boundary es solo visual: el inspector sigue mostrando su boundary real.
- **Capas y consola:** ocultar una capa no filtra la consola. Es una decisión deliberada para no ocultar eventos; existen los filtros por nodo, dominio, traza y texto.
- **Auditoría de accesibilidad:** el contraste de tokens se verificó programáticamente. Queda pendiente una auditoría automática completa (p. ej. axe) y una prueba con lector de pantalla.
- **Rendimiento:** no se probó con cientos de pulsos simultáneos. A 100 RPS el render sigue fluido en las pruebas.
