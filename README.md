# Máquina de escribir

Editor de texto de escritorio (Windows, macOS y Linux) hecho con Electron, con un **modo máquina de escribir**:

- La línea en la que escribes queda siempre fija sobre un **riel**; el texto sube al pulsar Enter.
- Un **carro** con un tipo en forma de "T" se desliza por el riel siguiendo al cursor.
- Una **lámpara** sale del carro e ilumina el texto con un cono de luz cálida.
- Dos **topes de margen** en el riel se arrastran para fijar los márgenes, carácter a carácter.
- Sonidos de teclas, retorno de carro y timbre de fin de línea (sintetizados, se pueden apagar).

## Formatos

| Formato | Abrir | Editar y guardar | Notas |
|---|:-:|:-:|---|
| Word `.docx` | ✓ | ✓ | Conserva tamaño de hoja, orientación, márgenes y tamaño de letra |
| Word 97-2003 `.doc` | ✓ | — | Se guarda como `.docx` |
| PDF `.pdf` | ✓ | ✓ | Reconstruye párrafos, sangrías y columnas simples; deduce hoja y márgenes |
| Texto `.txt` | ✓ | ✓ | |
| Markdown `.md` | ✓ | ✓ | |

El editor trabaja con **texto plano**, como una máquina de escribir. Al guardar sobre un
Word o PDF que vino de fuera, la app avisa antes de sobrescribir, porque se pierden
imágenes, tablas y estilos (negritas, títulos…). Siempre puedes guardar una copia.
Los PDF escaneados (imágenes sin texto) no se pueden abrir.

Formas de abrir un archivo: botón **Abrir** (Ctrl+O), **arrastrarlo** a la ventana, o
**«Abrir con…» / doble clic** si la app está instalada.

## La hoja

En **Ajustes → Hoja** se define, para cada documento:

- **Formato**: Carta, A4, Oficio, Legal, A5, B5 o personalizado (ancho × alto en cm).
- **Orientación**: vertical u horizontal.
- **Márgenes** superior, inferior, izquierdo y derecho (cm).
- **Letra** (pt) e **interlineado** (sencillo, 1,15, 1,5, doble).

La app muestra los **caracteres por línea** y las **líneas por página** que resultan,
y el contador de páginas de arriba usa esa misma hoja. Lo que ves en el editor se
corresponde línea por línea con el PDF que se genera.

- **Usar como predeterminada**: la hoja actual pasa a ser la de los documentos nuevos.
- **Restablecer**: aplica la hoja predeterminada al documento actual.
- **Mostrar la hoja**: dibuja el papel y los saltos de página detrás del texto.

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl+N | Nuevo documento |
| Ctrl+O | Abrir Word, PDF o texto |
| Ctrl+L | Biblioteca |
| Ctrl+S | Guardar (en el archivo vinculado, o pregunta dónde) |
| Ctrl+Shift+S | Guardar como… |
| Ctrl+P | Guardar una copia en PDF |
| Ctrl+Shift+T | Activar/desactivar la máquina de escribir |
| Ctrl+Shift+L | Tema claro/oscuro |
| Ctrl+Shift+N | Notas de escritura |
| Ctrl+, | Ajustes |
| F11 | Pantalla completa |
| Esc | Cerrar paneles |

## Uso

Requiere [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
npm start
```

### Crear el instalador para Windows

```bash
npm run dist:win
```

El instalador `.exe` queda en la carpeta `dist/` y asocia la app a los archivos `.docx`, `.pdf`, `.txt` y `.md`.

## Estructura

```
main.js          proceso principal: ventana, menús, diálogos, almacenamiento
preload.js       puente seguro con la interfaz
lib/formats.js   lectura y escritura de .docx, .doc, .pdf, .txt y .md
src/             interfaz (HTML, CSS, lógica del editor y sonidos)
```

La biblioteca guarda cada documento como JSON en la carpeta de datos de la aplicación
(en Windows: `%APPDATA%\maquina-de-escribir\documentos`), con autoguardado continuo.
