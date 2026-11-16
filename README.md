# Máquina de escribir

Editor de texto de escritorio (Windows, macOS y Linux) hecho con Electron, con un **modo máquina de escribir**:

- La línea en la que escribes queda siempre fija sobre un **riel**; el texto sube al pulsar Enter.
- Un **carro** con un tipo en forma de "T" se desliza por el riel siguiendo al cursor.
- Una **lámpara** sale del carro e ilumina el texto con un cono de luz cálida.
- Sonidos de teclas, retorno de carro y timbre de fin de línea (sintetizados, se pueden apagar).

## Funciones

| | |
|---|---|
| Biblioteca | Lista de documentos con guardado automático |
| Contador | Palabras en tiempo real |
| Temas | Claro (gris cálido) y oscuro (noche), con el botón ☀/☾ |
| Notas de escritura | Panel lateral de notas para cada documento |
| Ajustes | Tipografía, tamaño, ancho de línea, altura del riel, intensidad de la luz, sonido, atenuación y modo estricto (sin borrar) |
| Exportar | Word (.docx), texto (.txt) y Markdown (.md) |
| Abrir | Archivos .txt y .md |
| Releer | Rueda del ratón para ver el texto anterior sin mover el cursor |
| Modo normal | Desactiva la máquina para editar como en un procesador de texto clásico |
| Ortografía | Corrector en español con sugerencias en el clic derecho |

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl+N | Nuevo documento |
| Ctrl+O | Abrir archivo |
| Ctrl+L | Biblioteca |
| Ctrl+S | Guardar |
| Ctrl+E | Exportar a Word |
| Ctrl+Shift+T | Activar/desactivar la máquina de escribir |
| Ctrl+Shift+L | Tema claro/oscuro |
| Ctrl+Shift+N | Notas de escritura |
| Ctrl+, | Ajustes |
| F11 | Pantalla completa |
| Esc | Cerrar paneles |

## Uso

Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
npm start
```

### Crear el instalador para Windows

```bash
npm run dist:win
```

El instalador `.exe` queda en la carpeta `dist/`.

Los documentos se guardan como JSON en la carpeta de datos de la aplicación
(en Windows: `%APPDATA%\maquina-de-escribir\documentos`).
