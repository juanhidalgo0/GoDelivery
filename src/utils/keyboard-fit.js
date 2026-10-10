// Chats con el teclado abierto: el contenedor ocupa exactamente la parte visible de la pantalla,
// así el cuadro de texto queda siempre justo arriba del teclado.
//
// visualViewport es la parte que se ve. En iPhone (y en Chrome de Android) el teclado no achica la
// página: achica visualViewport y además corre la vista hacia abajo (offsetTop). Antes cada chat
// sumaba un relleno del alto del teclado (o nada) y el cuadro quedaba tapado o fuera de pantalla.
// En la app de Android el WebView ya se achica solo: ahí visualViewport mide lo mismo que la
// página y esto no cambia nada.
//
// container: el contenedor del chat, anclado arriba de la pantalla (fijo o dentro de un modal a
// pantalla completa). scroller: la lista de mensajes, que sigue en el último si estaba ahí.
// Devuelve la función que lo desactiva (llamarla al cerrar el chat).
export function fitToVisibleViewport(container, scroller = null) {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv || !container) return () => {};

  const apply = () => {
    const keyboardOpen = window.innerHeight - vv.height > 80;
    const nearBottom = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    if (keyboardOpen) {
      container.style.height = `${Math.round(vv.height)}px`;
      container.style.maxHeight = `${Math.round(vv.height)}px`;
      container.style.transform = `translateY(${Math.round(vv.offsetTop)}px)`;
    } else {
      container.style.height = '';
      container.style.maxHeight = '';
      container.style.transform = '';
    }
    // Se queda en el último mensaje si estaba ahí (no lo saca de un mensaje viejo que estaba leyendo)
    if (nearBottom) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  };

  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    container.style.height = '';
    container.style.maxHeight = '';
    container.style.transform = '';
  };
}

// Cuadro de texto que crece con lo escrito (hasta maxPx, después se desplaza adentro).
export function autoGrowTextarea(textarea, maxPx = 124) {
  if (!textarea) return () => {};
  const grow = () => {
    if (textarea.value === '') {
      // Vacío: una línea (el texto de ayuda en un cuadro angosto ocupa dos y lo agrandaba)
      textarea.style.height = '';
      textarea.style.overflowY = 'hidden';
      textarea.closest('.chat-input-bar')?.classList.remove('is-typing');
      return;
    }
    textarea.style.height = 'auto';
    // scrollHeight no incluye el borde (el cuadro es border-box)
    const border = textarea.offsetHeight - textarea.clientHeight;
    const needed = textarea.scrollHeight + border;
    textarea.style.height = `${Math.min(needed, maxPx)}px`;
    textarea.style.overflowY = needed > maxPx ? 'auto' : 'hidden';
    textarea.closest('.chat-input-bar')?.classList.toggle('is-typing', textarea.value.trim() !== '');
  };
  textarea.addEventListener('input', grow);
  grow();
  return grow;
}

// Tocar enviar (o el micrófono) no le saca el foco al cuadro: el teclado no se cierra y la
// pantalla no salta entre mensaje y mensaje.
export function keepFocusOnTap(input, ...buttons) {
  buttons.forEach(btn => btn?.addEventListener('mousedown', (e) => {
    if (document.activeElement === input) e.preventDefault();
  }));
}
