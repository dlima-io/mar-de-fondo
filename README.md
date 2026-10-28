# Mar de Fondo

Batalla naval todos contra todos para jugar en la oficina, en el navegador.
Esta primera etapa es el **modo práctica contra bots**: el juego completo funciona, y el modo online con compañeros se conecta en la próxima etapa.

## Publicarlo en GitHub Pages

1. Creá un repositorio nuevo en GitHub (por ejemplo `mar-de-fondo`).
2. Subí el contenido de esta carpeta a la raíz del repositorio (`index.html`, `css/`, `js/`).
3. En el repositorio, entrá a **Settings → Pages**, elegí **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`.
4. A los pocos minutos queda en `https://<tu-usuario>.github.io/mar-de-fondo/`.

No hace falta compilar nada: son archivos estáticos.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Pantallas y paneles |
| `css/style.css` | Estilos |
| `js/engine.js` | Motor de reglas: mapa, flota, resolución simultánea de rondas, tormenta, cajas, comodines y fantasmas. No toca la pantalla. |
| `js/bots.js` | Decisiones y frases de los bots. Solo usan lo que vería un jugador. |
| `js/render.js` | Dibujo del océano en canvas: agua, islas, barcos, humo, explosiones, tormenta, sonar. |
| `js/sound.js` | Sonidos sintetizados (sin archivos de audio). |
| `js/game.js` | Flujo de la partida, panel de órdenes, chat, zumbidos y la "mesa local" que hace de servidor. |
| `build.py` | Arma una versión de un solo archivo en `dist/` (opcional). |

## Reglas que ya están implementadas

- Océano compartido de 20x20 (hasta 4 jugadores) o 24x24 (5 o 6), con islas.
- Despliegue en sectores secretos, 60 segundos.
- Rondas simultáneas de 25 segundos: cada uno elige una acción y todas se ejecutan juntas.
- Flota: Acorazado (salva en cruz), Submarino (torpedo e inmersión), Fragata radar (sonar 4x4) y Lancha rápida.
- Humo público y disparos anónimos; los barcos hundidos quedan marcados.
- Recompensa por hundir: repara una casilla propia.
- Cajas de suministros cada 4 rondas, con comodines: escudo, reparación, cortina de humo y misil 2x2.
- Tormenta desde la ronda 10, que avanza cada 3 rondas.
- Fantasmas: el eliminado tira niebla 3x3 cada ronda.
- Chat general y privado, y zumbidos con límite (60 s por emisor, 30 s por destinatario) más zumbido automático a 10 s del final.

## Próxima etapa: modo online

El motor ya está separado para esto. El plan:

1. Crear un proyecto gratuito de Firebase (o Supabase).
2. Guardar en la base las salas, los jugadores, el chat y el estado público del mapa.
3. Una función en la nube recibe las órdenes secretas, llama a `MDF.resolveRound` y publica a cada jugador solo lo que le corresponde (`MDF.viewFor`).
4. En `game.js`, reemplazar la mesa local por un adaptador que lee y escribe en esa base.
5. Sumar el modo Guerra Fría, con rondas a horario fijo.
