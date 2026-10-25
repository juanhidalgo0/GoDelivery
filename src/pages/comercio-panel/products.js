// GoDelivery — Comercio Products Management
import { db } from '../../firebase.js';
import { canManageCommerce } from '../../utils/my-commerces.js';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { formatPrice } from '../../utils/format.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { openCropper } from '../../utils/cropper.js';
import { uploadDataUrlImage } from '../../utils/storage-upload.js';
import { isAdmin } from '../../auth.js';
import { escapeHtml } from '../../utils/escape.js';
import { enterCommercePanel, cpEmpty, cpSkeleton, cpSheet } from './shell.js';
import { WEIGHT_STEPS, weightStepOf, isSoldByWeight, formatWeight } from '../../utils/weight.js';

let panelFilteredProducts = [];
let panelDisplayedCount = 20;
let panelScrollObserver = null;
let panelComercioData = null;
let panelCategories = [];
let isSyncAllowed = false;

export async function renderComercioProducts() {
  const user = getState().user;
  const params = getRouteParams();
  const comercioId = params.id;
  if (!comercioId) return;

  const content = await enterCommercePanel({ comercioId, tab: 'menu' });
  if (!content) return;

  content.innerHTML = `
    <div id="cp-menu-root">
      <div class="cp-sticky">
        <div class="cp-row">
          <label class="cp-search cp-grow">
            <span>${icon('search', 18)}</span>
            <input class="cp-input" type="search" id="products-search" placeholder="Buscar producto" autocomplete="off" />
          </label>
          <button type="button" class="cp-btn is-red" id="add-product-btn" aria-label="Nuevo producto" style="padding:0 14px">${icon('plus', 20)}<span class="cp-hide-xs">Nuevo</span></button>
        </div>
        <div class="cp-chips" id="products-categories-filter" style="margin-top:10px"></div>
      </div>
      <div class="cp-page" style="padding-top:4px">
        <div class="cp-row" style="margin:2px 2px 10px">
          <span class="cp-small cp-grow cp-ellipsis" id="products-summary">Cargando…</span>
          <a class="cp-btn is-sm" href="#/mi-comercio/${comercioId}/categorias">${icon('list', 16)} Categorías</a>
          <button type="button" class="cp-btn is-sm" id="open-products-sidebar-btn">${icon('settings', 16)} Más</button>
        </div>
        <div class="cp-list" id="products-list">${cpSkeleton(4, 64)}</div>
        <p class="cp-small" style="text-align:center; margin-top:4px">Tocá un producto para editarlo. El interruptor marca si hay o no hay.</p>
      </div>
    </div>
  `;

  let products = [];
  let categories = [];
  let currentCategoryId = 'all';
  let comercioData = null;
  isSyncAllowed = false;

  const updateTotalCount = () => {
    const totalEl = document.getElementById('products-total-count');
    if (totalEl) totalEl.textContent = products.length;
  };

  try {
    const comercioSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (!comercioSnap.exists()) {
      location.hash = '#/profile';
      return;
    }
    comercioData = comercioSnap.data();
    if (!canManageCommerce(comercioData, user.uid) && !isAdmin()) {
      location.hash = '#/profile';
      return;
    }
    panelComercioData = comercioData;
    // La conexión vieja con la caja local; con Ventra vinculado (puente nuevo) ya no se usa
    isSyncAllowed = !comercioData.ventraLinked && (comercioId === '6R8ikb9wsjUCQuOANOMHuAZZxss2' || canManageCommerce(comercioData, user.uid));


    const prodsSnap = await getDocs(collection(db, 'comercios', comercioId, 'products'));
    products = prodsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Sanitize: Limit onlyInApp products to maximum 3 per commerce
    const appOnlyProds = products.filter(p => p.onlyInApp === true);
    if (appOnlyProds.length > 3) {
      appOnlyProds.sort((a, b) => {
        const aTime = a.createdAt?.seconds || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bTime = b.createdAt?.seconds || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bTime - aTime;
      });
      const excessProds = appOnlyProds.slice(3);
      for (const p of excessProds) {
        p.onlyInApp = false;
        try {
          await updateDoc(doc(db, 'comercios', comercioId, 'products', p.id), { onlyInApp: false });
        } catch (errSanitize) {
          console.warn('Error sanitizing excess onlyInApp product:', p.id, errSanitize);
        }
      }
    }

    const catsSnap = await getDocs(query(collection(db, 'comercios', comercioId, 'categories'), orderBy('order')));
    categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    panelCategories = categories;

    updateTotalCount();
    renderCategoriesFilter(categories);
    renderProductsList(products, '', currentCategoryId);
  } catch (e) {
    console.error('Error loading products:', e);
    const list = document.getElementById('products-list');
    if (list) list.outerHTML = cpEmpty('alertTriangle', 'No pudimos cargar tu menú', 'Revisá la conexión y volvé a entrar.');
  }

  function renderCategoriesFilter(cats) {
    const container = document.getElementById('products-categories-filter');
    if (!container) return;
    const offCount = products.filter(p => p.isAvailable === false).length;
    const chip = (id, label, count = '') => `<button type="button" class="cp-chip ${currentCategoryId === id ? 'is-on' : ''}" data-cat-id="${id}">${label}${count !== '' ? ` <span class="cp-count">${count}</span>` : ''}</button>`;
    container.innerHTML = chip('all', 'Todo', products.length)
      + (offCount ? chip('__off', 'Sin stock', offCount) : '')
      + cats.map(c => chip(c.id, escapeHtml(c.name))).join('');
    container.querySelectorAll('[data-cat-id]').forEach(btn => {
      btn.onclick = () => {
        currentCategoryId = btn.dataset.catId;
        renderCategoriesFilter(categories);
        renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
      };
    });
    const summary = document.getElementById('products-summary');
    if (summary) summary.textContent = `${products.length} producto${products.length === 1 ? '' : 's'}${offCount ? ` · ${offCount} sin stock` : ''}`;
  }

  // "Más": herramientas que se usan de vez en cuando
  const closeDrawer = () => {};
  const openDrawer = () => {
    const item = (k, ic, t, d) => `<button type="button" class="cp-item" data-tool="${k}"><span class="cp-item-icon">${icon(ic, 20)}</span><span class="cp-grow"><span class="cp-item-title">${t}</span><span class="cp-item-sub" style="display:block">${d}</span></span></button>`;
    const sheet = cpSheet({
      title: 'Herramientas del menú',
      bodyHtml: `<div class="cp-list">
        ${item('sabores', 'sparkles', 'Sabores y gustos', 'Helados, empanadas, pizzas: qué gustos hay hoy')}
        ${item('increase', 'percent', 'Aumentar precios', 'Subí un % o un monto a una o varias categorías')}
        ${item('import', 'upload', 'Cargar desde Excel o CSV', 'Muchos productos de una sola vez')}
        ${item('export', 'download', 'Descargar mi menú', 'Copia de todos tus productos')}
      </div>`,
      actions: [{ label: 'Cerrar', cls: 'is-ghost' }],
    });
    sheet.el.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
      sheet.close();
      const k = b.dataset.tool;
      if (k === 'sabores') location.hash = `#/mi-comercio/${comercioId}/sabores`;
      if (k === 'increase') handleBulkIncrease();
      if (k === 'import') handleImportDb();
      if (k === 'export') handleExportDb();
    }));
  };
  document.getElementById('open-products-sidebar-btn')?.addEventListener('click', openDrawer);

  const handleAddProduct = () => {
    closeDrawer();
    showProductModal(null, categories, comercioId, async (product) => {
      products.push(product);
      updateTotalCount();
      renderCategoriesFilter(categories);
      renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
    }, (newCat) => {
      renderCategoriesFilter(categories);
    }, comercioData);
  };

  const handleBulkIncrease = () => {
    closeDrawer();
    showBulkPriceIncreaseModal(products, categories, comercioId, () => {
      renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
    });
  };

  const handleImportDb = () => {
    closeDrawer();
    handleImportDatabase();
  };

  // Descarga un Excel con las mismas columnas que entiende "Cargar desde Excel": sirve de
  // copia y para cambiar precios en la compu y volver a subirlos.
  const handleExportDb = async () => {
    if (products.length === 0) {
      showToast('Todavía no tenés productos para descargar', 'warning');
      return;
    }
    try {
      showToast('Armando el archivo…', 'info');
      const XLSXLib = await loadXLSX();
      const rows = products.map(p => ({
        nombre: p.name || '',
        precio: Number(p.price) || 0,
        categoria: categories.find(c => c.id === p.categoryId)?.name || '',
        codigo: p.barcode || '',
        stock: p.stockMode === 'limited' ? (p.stockQuantity ?? 0) : '',
        descripcion: p.description || '',
        imagen: p.image || p.imageUrl || '',
        disponible: p.isAvailable === false ? 'no' : 'si',
      }));
      const sheet = XLSXLib.utils.json_to_sheet(rows);
      const book = XLSXLib.utils.book_new();
      XLSXLib.utils.book_append_sheet(book, sheet, 'Menú');
      const clean = (comercioData?.name || 'comercio').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
      XLSXLib.writeFile(book, `menu-${clean}.xlsx`);
    } catch (err) {
      console.error('Error exporting products:', err);
      showToast('No se pudo armar el archivo. Probá de nuevo.', 'error');
    }
  };

  document.getElementById('add-product-btn')?.addEventListener('click', handleAddProduct);

  let searchTimer = null;
  document.getElementById('products-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderProductsList(products, e.target.value || '', currentCategoryId), 150);
  });

  const requestDelete = (product) => {
    document.getElementById('products-list')?.dispatchEvent(new CustomEvent('click', { detail: { deleteId: product.id } }));
  };

  // Actions
  document.getElementById('products-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');
    const toggleBtn = e.target.closest('[data-action="toggle"]');

    if (editBtn) {
      const product = products.find(p => p.id === editBtn.dataset.id);
      if (product) {
        showProductModal(product, categories, comercioId, (updated) => {
          const idx = products.findIndex(p => p.id === updated.id);
          if (idx >= 0) products[idx] = updated;
          renderCategoriesFilter(categories);
          renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
        }, (newCat) => {
          renderCategoriesFilter(categories);
        }, comercioData, requestDelete);
      }
    }

    // El editor pide borrar despachando { deleteId } sobre la lista (ver requestDelete)
    if (deleteBtn || e.detail?.deleteId) {
      const product = products.find(p => p.id === (deleteBtn ? deleteBtn.dataset.id : e.detail.deleteId));
      if (product) {
        const doDeleteCloud = async () => {
          await deleteDoc(doc(db, 'comercios', comercioId, 'products', product.id));
          products = products.filter(p => p.id !== product.id);
          updateTotalCount();
          renderCategoriesFilter(categories);
          renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
        };

        const doDeleteLocalSync = async () => {
          try {
            const res = await fetch(`http://localhost:3001/api/sync/product/${product.barcode}`, {
              method: 'DELETE',
              headers: {
                'x-sync-token': 'paulos-local-sync-token-secret-2026'
              }
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.message || 'Error del POS local');
            }
          } catch (err) {
            console.error('Error in local delete sync:', err);
            showToast('No se pudo dar de baja en Kiosco POS local. ¿El servidor está encendido?', 'warning');
          }
        };

        if (product.barcode && isSyncAllowed) {
          showSyncConfirm({
            title: 'Dar de Baja Producto',
            message: `¿Querés eliminar "${product.name}" únicamente de tu tienda online GoDelivery, o también desactivarlo en tu sistema local Kiosco POS?`,
            onSyncBoth: async () => {
              await doDeleteCloud();
              await doDeleteLocalSync();
              showToast('Producto dado de baja en ambos sistemas', 'success');
            },
            onSyncOnlyCloud: async () => {
              await doDeleteCloud();
              showToast('Producto eliminado solo de GoDelivery', 'info');
            },
            onCancel: () => {}
          });
        } else {
          showConfirm({
            title: 'Eliminar producto',
            message: `¿Eliminar "${product.name}"?`,
            confirmText: 'Eliminar',
            danger: true,
            onConfirm: async () => {
              try {
                await doDeleteCloud();
                showToast('Producto eliminado', 'info');
              } catch (e) {
                showToast('Error al eliminar', 'error');
              }
            }
          });
        }
      }
    }

    if (toggleBtn) {
      const product = products.find(p => p.id === toggleBtn.dataset.id);
      if (product) {
        const newAvail = product.isAvailable === false;
        try {
          // Producto de Ventra: ocultarlo acá queda firme (Ventra no lo vuelve a mostrar)
          await updateDoc(doc(db, 'comercios', comercioId, 'products', product.id), { isAvailable: newAvail, ...(product.source === 'ventra' ? { hiddenInGo: !newAvail } : {}) });
          product.isAvailable = newAvail;
          renderCategoriesFilter(categories);
          renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
          showToast(newAvail ? 'Producto disponible' : 'Producto no disponible', 'info');
        } catch (e) {
          showToast('Error', 'error');
        }
      }
    }
  });

  async function handleImportDatabase() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, .json, .xlsx, .xls';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const extension = file.name.split('.').pop().toLowerCase();
      
      showModal({
        title: 'Importar Base de Datos',
        content: `
          <div style="padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: 200px;">
            <div style="border: 3px solid #E5E7EB; border-top: 3px solid var(--color-primary); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
            <div style="font-weight: 800; font-size: 16px; color: var(--color-text-primary);" id="import-status-text">Procesando archivo...</div>
            <div style="width: 100%; border-radius: 10px; height: 8px; overflow: hidden; background: var(--color-border-light); display: none;" id="import-progress-bar-container">
              <div style="width: 0%; height: 100%; background: var(--color-primary); transition: width 0.1s;" id="import-progress-bar"></div>
            </div>
            <div style="font-size: 13px; color: var(--color-text-secondary); text-align: center; max-width: 320px; line-height: 1.5;" id="import-info-text">Estamos leyendo la base de datos para mapear los productos.</div>
          </div>
          <style>
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        `,
        hideHeader: false,
        height: 'auto',
        footer: `<button class="btn btn-ghost" id="import-modal-close" style="display: none;">Cerrar</button>`
      });

      document.getElementById('import-modal-close').onclick = () => closeModal();

      try {
        let importedRows = [];

        if (extension === 'json') {
          const text = await file.text();
          const json = JSON.parse(text);
          const rawRows = Array.isArray(json) ? json : (json.products || json.items || []);
          importedRows = rawRows.map(mapImportedRow);
        } else if (extension === 'csv') {
          const text = await file.text();
          const rawRows = parseCSV(text);
          importedRows = rawRows.map(mapImportedRow);
        } else if (extension === 'xlsx' || extension === 'xls') {
          const XLSXLib = await loadXLSX();
          const data = await file.arrayBuffer();
          const workbook = XLSXLib.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const rawRows = XLSXLib.utils.sheet_to_json(worksheet);
          importedRows = rawRows.map(mapImportedRow);
        } else {
          throw new Error('Formato de archivo no soportado.');
        }

        // Filter valid rows (must have a name)
        const validRows = importedRows.filter(r => r.name && r.name.trim() !== '');

        if (validRows.length === 0) {
          document.getElementById('import-status-text').textContent = 'Error al importar';
          document.getElementById('import-info-text').textContent = 'No se encontraron productos válidos en el archivo. Asegúrate de tener al menos una columna con el nombre/descripción.';
          document.getElementById('import-modal-close').style.display = 'block';
          return;
        }

        document.getElementById('import-status-text').textContent = 'Confirmar Importación';
        document.getElementById('import-info-text').innerHTML = `Se detectaron <strong>${validRows.length} productos</strong> válidos en el archivo.<br/>¿Deseas agregarlos a tu catálogo online?`;
        
        const footer = document.querySelector('.modal-footer') || document.getElementById('modal-footer');
        if (footer) {
          footer.innerHTML = `
            <button class="btn btn-ghost" id="import-btn-cancel">Cancelar</button>
            <button class="btn btn-primary" id="import-btn-confirm">Importar</button>
          `;
          
          document.getElementById('import-btn-cancel').onclick = () => closeModal();
          document.getElementById('import-btn-confirm').onclick = async () => {
            const confirmBtn = document.getElementById('import-btn-confirm');
            const cancelBtn = document.getElementById('import-btn-cancel');
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            confirmBtn.textContent = 'Importando...';

            document.getElementById('import-progress-bar-container').style.display = 'block';
            document.getElementById('import-info-text').textContent = 'Subiendo productos a la nube...';

            let count = 0;
            const total = validRows.length;
            const chunkSize = 400;

            for (let i = 0; i < total; i += chunkSize) {
              const chunk = validRows.slice(i, i + chunkSize);
              const batch = writeBatch(db);
              const batchProducts = [];

              for (const row of chunk) {
                // Resolve category
                let categoryId = '';
                if (row.categoryName && row.categoryName.trim() !== '') {
                  let cat = categories.find(c => c.name.toLowerCase().trim() === row.categoryName.toLowerCase().trim());
                  if (!cat) {
                    const nextOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order || 0)) + 1 : 0;
                    const newCatRef = doc(collection(db, 'comercios', comercioId, 'categories'));
                    const newCatData = {
                      name: row.categoryName,
                      order: nextOrder,
                      createdAt: new Date()
                    };
                    await setDoc(newCatRef, newCatData);
                    cat = { id: newCatRef.id, ...newCatData };
                    categories.push(cat);
                    renderCategoriesFilter(categories);
                  }
                  categoryId = cat.id;
                }

                // Save product to Firestore (add to batch)!
                const newRef = doc(collection(db, 'comercios', comercioId, 'products'));
                const productData = {
                  name: row.name,
                  barcode: row.barcode,
                  description: row.description,
                  price: row.price,
                  categoryId: categoryId,
                  image: row.image || '',
                  optionsGroups: [],
                  isAvailable: true,
                  stockMode: row.stockMode,
                  stockQuantity: row.stockQuantity,
                  stockThreshold: 3,
                  order: 0,
                  createdAt: new Date()
                };

                batch.set(newRef, productData);
                batchProducts.push({ id: newRef.id, ...productData });
                count++;
              }

              // Commit batch of up to 400 products at once
              await batch.commit();
              products.push(...batchProducts);

              const progressPercent = Math.round((count / total) * 100);
              document.getElementById('import-progress-bar').style.width = `${progressPercent}%`;
              document.getElementById('import-status-text').textContent = `Importando: ${count} de ${total}`;
            }

            // Success final step
            updateTotalCount();
            renderProductsList(products, '', currentCategoryId);

            document.getElementById('import-status-text').textContent = '¡Importación Completa!';
            document.getElementById('import-info-text').innerHTML = `Se importaron con éxito <strong>${total} productos</strong>.`;
            document.getElementById('import-progress-bar-container').style.display = 'none';
            
            footer.innerHTML = `<button class="btn btn-primary" id="import-btn-finished" style="width:100%;">Finalizar</button>`;
            document.getElementById('import-btn-finished').onclick = () => closeModal();
            showToast('Base de datos importada con éxito', 'success');
          };
        }

      } catch (err) {
        console.error('Import error:', err);
        document.getElementById('import-status-text').textContent = 'Error';
        document.getElementById('import-info-text').textContent = `Ocurrió un error al procesar el archivo: ${err.message}`;
        const footer = document.querySelector('.modal-footer') || document.getElementById('modal-footer');
        if (footer) {
          footer.innerHTML = `<button class="btn btn-ghost" id="import-btn-error-close" style="width:100%;">Cerrar</button>`;
          document.getElementById('import-btn-error-close').onclick = () => closeModal();
        }
      } finally {
        input.remove();
      }
    };

    input.click();
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    const headerLine = lines[0];
    let separator = ',';
    if (headerLine.includes(';')) separator = ';';
    else if (headerLine.includes('\t')) separator = '\t';
    
    const headers = headerLine.split(separator).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
    
    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === separator && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      
      const row = {};
      headers.forEach((header, index) => {
        let val = values[index] || '';
        val = val.replace(/^["']|["']$/g, '');
        row[header] = val;
      });
      results.push(row);
    }
    return results;
  }

  async function loadXLSX() {
    if (window.XLSX) return window.XLSX;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = () => resolve(window.XLSX);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function mapImportedRow(row) {
    const findVal = (keys) => {
      for (const key of keys) {
        const match = Object.keys(row).find(k => k.toLowerCase().trim() === key.toLowerCase());
        if (match) return row[match];
      }
      return null;
    };

    const barcode = findVal(['barcode', 'codigo', 'codigo_barra', 'num_art', 'ean', 'upc', 'id']) || '';
    const name = findVal(['name', 'nombre', 'descripcion', 'desc', 'titulo', 'title', 'articulo']) || '';
    const priceRaw = findVal(['price', 'precio', 'precio_venta', 'sale_price', 'preciodeventa', 'precioa', 'costo']) || '0';
    const stockRaw = findVal(['stock', 'cantidad', 'stockquantity', 'existencia', 'qty', 'cant']) || '';
    const categoryName = findVal(['category', 'categoria', 'rubro', 'seccion']) || '';
    const description = findVal(['description', 'detalles', 'info', 'detalle']) || '';
    const image = findVal(['image', 'imagen', 'img', 'url_imagen', 'imageurl', 'image_url']) || '';

    const price = parseFloat(priceRaw.toString().replace(/[^0-9.-]/g, '')) || 0;
    const stock = stockRaw !== '' ? parseInt(stockRaw.toString().replace(/[^0-9]/g, '')) : null;

    return {
      name: name.toString().trim(),
      barcode: barcode.toString().trim(),
      price: price,
      stockMode: stock !== null ? 'limited' : 'unlimited',
      stockQuantity: stock !== null ? stock : 0,
      categoryName: categoryName.toString().trim(),
      description: description.toString().trim(),
      image: image.toString().trim()
    };
  }
}

function stockLabel(p) {
  const threshold = p.stockThreshold !== undefined ? p.stockThreshold : 3;
  let qty = null;
  if (p.useGlobalFlavors) {
    const flavors = (p.allowedFlavors && p.allowedFlavors.length > 0)
      ? (panelComercioData?.sabores || []).filter(s => p.allowedFlavors.includes(s.name))
      : (panelComercioData?.sabores || []);
    const unlimited = flavors.some(s => !s.isAvailable || s.stock === undefined || s.stock === null || s.stock === '');
    if (!unlimited) qty = flavors.reduce((sum, s) => sum + (parseInt(s.stock) || 0), 0);
  } else if (p.stockMode === 'limited') {
    qty = p.stockQuantity || 0;
  }
  if (qty === null) return '';
  if (qty <= 0) return '<span class="cp-tag is-red">Se agotó</span>';
  if (qty <= threshold) return `<span class="cp-tag is-amber">Quedan ${qty}</span>`;
  return `<span class="cp-tag">${qty} en stock</span>`;
}

function renderProductsList(products, search, categoryId) {
  const container = document.getElementById('products-list');
  if (!container) return;

  if (panelScrollObserver) {
    panelScrollObserver.disconnect();
    panelScrollObserver = null;
  }

  let filtered = products;
  if (categoryId === '__off') {
    filtered = filtered.filter(p => p.isAvailable === false);
  } else if (categoryId && categoryId !== 'all') {
    filtered = filtered.filter(p => p.categoryId === categoryId);
  }
  if (search) {
    const normalizeStr = str => (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const queryTokens = normalizeStr(search).split(/\s+/).filter(Boolean);
    filtered = filtered.filter(p => {
      const catNorm = p.categoryId ? normalizeStr(panelCategories.find(c => c.id === p.categoryId)?.name) : '';
      const targetText = `${normalizeStr(p.name)} ${normalizeStr(p.barcode)} ${catNorm} ${normalizeStr(p.description)}`;
      return queryTokens.every(token => targetText.includes(token));
    });
  }

  if (filtered.length === 0) {
    const hasFilter = search || categoryId !== 'all';
    container.innerHTML = hasFilter
      ? cpEmpty('search', 'Sin resultados', 'Probá con otra búsqueda o categoría.')
      : cpEmpty('restaurant', 'Tu menú está vacío', 'Cargá tu primer producto con el botón Nuevo, o muchos juntos desde Excel en "Más".');
    return;
  }

  panelFilteredProducts = filtered;
  panelDisplayedCount = 30;

  const renderPanelBatch = (startIndex, count) => panelFilteredProducts.slice(startIndex, startIndex + count).map(p => {
    const off = p.isAvailable === false;
    const img = (p.image || p.imageUrl || p.croppedImage || '').trim();
    const categoryName = categoryId === 'all' && p.categoryId ? (panelCategories.find(c => c.id === p.categoryId)?.name || '') : '';
    const name = escapeHtml(p.name || 'Sin nombre');
    return `
      <div class="cp-prod ${off ? 'is-off' : ''}">
        <button type="button" class="cp-prod-edit" data-action="edit" data-id="${p.id}">
          <img class="cp-prod-img" src="${img || '/logo.png'}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/logo.png'" />
          <span class="cp-grow">
            <span class="cp-prod-name" style="display:block">${name}</span>
            <span class="cp-prod-price cp-row" style="flex-wrap:wrap; gap:6px; margin-top:4px">
              <span class="cp-money">${formatPrice(p.price)}${isSoldByWeight(p) ? ' /kg' : ''}</span>
              ${off ? '<span class="cp-tag is-red">Sin stock</span>' : stockLabel(p)}
              ${p.onlyInApp ? '<span class="cp-tag">Sólo en la app</span>' : ''}
              ${categoryName ? `<span class="cp-small">${escapeHtml(categoryName)}</span>` : ''}
            </span>
          </span>
        </button>
        <button type="button" class="cp-switch" role="switch" aria-checked="${!off}" aria-label="${off ? 'Marcar que hay' : 'Marcar sin stock'}: ${name}" data-action="toggle" data-id="${p.id}"></button>
      </div>`;
  }).join('');

  container.innerHTML = renderPanelBatch(0, panelDisplayedCount);

  const setupPanelSentinel = () => {
    if (panelDisplayedCount >= panelFilteredProducts.length) return;
    const sentinel = document.createElement('div');
    sentinel.id = 'panel-scroll-sentinel';
    sentinel.style.cssText = 'height: 40px;';
    container.appendChild(sentinel);
    panelScrollObserver = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      panelScrollObserver.disconnect();
      sentinel.remove();
      const prevCount = panelDisplayedCount;
      panelDisplayedCount = Math.min(panelDisplayedCount + 30, panelFilteredProducts.length);
      container.insertAdjacentHTML('beforeend', renderPanelBatch(prevCount, panelDisplayedCount - prevCount));
      setupPanelSentinel();
    }, { threshold: 0.1 });
    panelScrollObserver.observe(sentinel);
  };
  setupPanelSentinel();
}

function showProductModal(product, categories, comercioId, onSave, onCategoryAdded, _comercioData = null, onDelete = null) {
  const comercioCategory = panelComercioData?.category || 'Comida';
  let croppedImage = product ? (product.image || product.imageUrl || null) : null;

  const flavorGroup = product?.optionsGroups?.find(g => g.name === 'Elegí tu sabor');
  const allowFlavors = !!flavorGroup;
  const flavorsList = flavorGroup ? flavorGroup.options.map(o => o.name).join(', ') : '';

  showModal({
    title: product ? 'Editar Producto' : 'Nuevo Producto',
    headerBackground: 'var(--color-primary)',
    headerTextColor: '#ffffff',
    content: `
      <style>
        .panel-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 8px 16px 24px 16px;
          overflow-y: auto;
          height: 100%;
        }
        .form-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02);
        }
        .form-card-title {
          font-size: 14px;
          font-weight: 800;
          color: var(--color-text-primary);
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-display);
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 0;
        }
        .input-group label {
          font-size: 12px;
          font-weight: 750;
          color: var(--color-text-secondary);
        }
        .input-premium {
          height: 48px;
          border-radius: 12px;
          border: 1.5px solid #e2e8f0;
          padding: 0 16px;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-primary);
          width: 100%;
          background: #f8fafc;
          transition: all 0.2s ease;
        }
        .input-premium:focus {
          background: #ffffff;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 4px rgba(225, 29, 72, 0.1);
          outline: none;
        }
        .textarea-premium {
          height: 90px;
          border-radius: 12px;
          border: 1.5px solid #e2e8f0;
          padding: 12px 16px;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-primary);
          width: 100%;
          background: #f8fafc;
          resize: none;
          line-height: 1.5;
          transition: all 0.2s ease;
        }
        .textarea-premium:focus {
          background: #ffffff;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 4px rgba(225, 29, 72, 0.1);
          outline: none;
        }
        .switch-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #f8fafc;
          padding: 16px;
          border-radius: 14px;
          border: 1.5px solid #e2e8f0;
          transition: all 0.2s ease;
        }
        .switch-container:hover {
          border-color: #cbd5e1;
        }
        .prod-switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 28px;
          margin: 0;
          cursor: pointer;
          flex-shrink: 0;
        }
        .prod-switch input { 
          opacity: 0;
          width: 0;
          height: 0;
        }
        .prod-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #cbd5e1;
          transition: .3s;
          border-radius: 34px;
        }
        .prod-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 4px;
          bottom: 4px;
          background-color: white;
          transition: .3s;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }
        .prod-switch input:checked + .prod-slider {
          background-color: var(--color-success) !important;
        }
        .prod-switch input:checked + .prod-slider:before {
          transform: translateX(22px);
        }
      </style>

      <div class="panel-form">
        <!-- Availability & Quick Status Switch -->
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:14px 16px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 8px rgba(0,0,0,0.02);">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; border-radius:10px; background:rgba(34,197,94,0.1); color:#22c55e; display:flex; align-items:center; justify-content:center;">
              ${icon('checkCircle', 20)}
            </div>
            <div>
              <div style="font-size:13px; font-weight:850; color:var(--color-text-primary);">Estado del Producto</div>
              <div style="font-size:11px; font-weight:700; color:var(--color-text-secondary); margin-top:1px;">Visibilidad activa para clientes</div>
            </div>
          </div>
          <label class="prod-switch" style="width:50px; height:28px; cursor:pointer; position:relative; display:inline-block; margin:0; flex-shrink:0;">
            <input type="checkbox" id="prod-status-toggle" ${product ? (product.isAvailable !== false ? 'checked' : '') : 'checked'} style="opacity:0; width:0; height:0;" />
            <span class="prod-slider" style="position:absolute; inset:0; border-radius:34px; transition:0.2s; cursor:pointer;"></span>
          </label>
        </div>

        <!-- Hero Image Upload Dropzone -->
        <div class="form-card" style="padding:16px;">
          <div class="form-card-title">
            ${icon('image', 18)} Imagen del Producto
          </div>
          <div class="image-upload" id="prod-image-upload" style="border: 2px dashed var(--color-primary); border-radius: 16px; background: rgba(225,29,72,0.02); overflow: hidden; position: relative; height: 170px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;">
            <img src="${product?.image || ''}" alt="Preview" id="prod-image-preview" style="max-height: 100%; max-width: 100%; object-fit: contain; ${product?.image ? '' : 'display:none;'}" />
            <div id="prod-image-placeholder" style="display:${product?.image ? 'none' : 'flex'}; flex-direction:column; align-items:center; gap:6px; color:var(--color-primary);">
              <div style="width:44px; height:44px; border-radius:50%; background:rgba(225,29,72,0.1); display:flex; align-items:center; justify-content:center;">
                ${icon('upload', 22)}
              </div>
              <span style="font-size:12px; font-weight:800; color:var(--color-text-primary);">Subir Foto del Producto</span>
              <span style="font-size:10px; font-weight:700; color:var(--color-text-tertiary);">Formatos JPG, PNG • Máx 5MB</span>
            </div>
            <input type="file" accept="image/*" id="prod-image-input" style="position: absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;" />
          </div>
        </div>

        <!-- Main Info Card -->
        <div class="form-card" style="display: flex; flex-direction: column; gap: 16px;">
          <div class="form-card-title">
            ${icon('package', 18)} Información Básica
          </div>
          
          <div class="input-group">
            <label>Nombre del Producto *</label>
            <input type="text" class="input-premium" id="prod-name" value="${escapeHtml(product?.name || '')}" placeholder="Ej: Empanada de Carne Receta Salteña" />
            ${product?.source === 'ventra' ? `
              <div style="font-size:12px; color:var(--color-text-secondary); margin-top:6px; line-height:1.4;">
                Viene de tu caja Ventra${product.ventraName ? ` como <b>${escapeHtml(product.ventraName)}</b>` : ''}. Si le cambiás el nombre acá, en la app queda este y Ventra ya no lo cambia. El precio sigue viniendo de la caja.
              </div>
              ${product.nameLockedInGo && product.ventraName && product.ventraName !== product.name ? `<button type="button" id="prod-name-from-ventra" style="margin-top:6px; min-height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-weight:700; font-size:12.5px; cursor:pointer;">Volver al nombre de Ventra</button>` : ''}` : ''}
          </div>
          
          <div class="input-group">
            <label>Código de Barras (opcional, para sincronizar con POS)</label>
            <input type="text" class="input-premium" id="prod-barcode" value="${product?.barcode || ''}" placeholder="Ej: 7791234567890" />
          </div>
          
          <div class="input-group">
            <label>Descripción</label>
            <textarea class="textarea-premium" id="prod-desc" placeholder="Detallá los ingredientes o características del producto...">${product?.description || ''}</textarea>
          </div>
          
          <div class="switch-container">
            <div style="text-align:left;">
              <div style="font-size:13px; font-weight:750; color:var(--color-text-primary);">Se vende por peso</div>
              <div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">Para carne, fiambre, verdura… Cargás el precio por kilo y al preparar el pedido anotás lo que pesó.</div>
            </div>
            <label class="prod-switch" style="width:50px; height:28px; cursor:pointer; position:relative; display:inline-block; margin:0; flex-shrink:0;">
              <input type="checkbox" id="prod-sold-by-weight" ${isSoldByWeight(product) ? 'checked' : ''} style="opacity:0; width:0; height:0;" />
              <span class="prod-slider" style="position:absolute; inset:0; border-radius:34px; transition:0.2s; cursor:pointer;"></span>
            </label>
          </div>

          <div id="prod-weight-fields" class="input-group" style="display:${isSoldByWeight(product) ? 'flex' : 'none'};">
            <label>El cliente elige de a</label>
            <select class="input-premium" id="prod-weight-step" style="background-image: none;">
              ${WEIGHT_STEPS.map(g => `<option value="${g}" ${weightStepOf(product) === g ? 'selected' : ''}>${formatWeight(g)}</option>`).join('')}
            </select>
            <div style="font-size:11px; color:var(--color-text-secondary); margin-top:4px; line-height:1.4;">
              El cliente ve un precio estimado. Al marcar el pedido como listo cargás el peso real y se cobra eso: hasta un 10% más o menos de lo pedido sin preguntarle. Si te pasás de ahí, primero hablalo con él por el chat.
              Si el producto tiene opciones con precio, ese precio también es por kilo.
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div class="input-group">
              <label id="prod-price-label">${isSoldByWeight(product) ? 'Precio por kilo ($) *' : 'Precio de Venta ($) *'}</label>
              <div style="position:relative; display:flex; align-items:center;">
                <span style="position:absolute; left:16px; font-weight:900; color:var(--color-primary); font-size:16px;">$</span>
                <input type="number" class="input-premium" id="prod-price" value="${product?.price || ''}" placeholder="0" min="0" ${product?.source === 'ventra' ? 'readonly title="El precio lo manda tu caja Ventra"' : ''} style="padding-left:32px; font-size:16px; font-weight:900; color:var(--color-primary);" />
              </div>
              ${product?.source === 'ventra' ? '<div style="font-size:11.5px; color:var(--color-text-tertiary); margin-top:4px;">Lo cambiás en la caja Ventra.</div>' : ''}
            </div>

            <div class="input-group">
              <label>Precio de Compra / Costo ($)</label>
              <div style="position:relative; display:flex; align-items:center;">
                <span style="position:absolute; left:16px; font-weight:900; color:var(--color-text-secondary); font-size:16px;">$</span>
                <input type="number" class="input-premium" id="prod-cost-price" value="${product?.costPrice !== undefined ? product.costPrice : ''}" placeholder="0" min="0" style="padding-left:32px; font-size:16px; font-weight:900; color:var(--color-text-primary);" />
              </div>
            </div>
          </div>

          <!-- Dynamic Profit Margin Badge Indicator -->
          <div id="prod-profit-calc-badge" style="background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:12px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:800;">
            <span style="color:var(--color-text-secondary);">Margen de Ganancia Estimado:</span>
            <span id="prod-profit-calc-value" style="color:#10b981; font-weight:900;">$0 (0%)</span>
          </div>
          
          <div class="input-group">
            <label>Categoría</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select class="input-premium" id="prod-category" style="flex:1; background-image: none;">
                <option value="">Sin categoría</option>
                ${categories.map(c => `<option value="${c.id}" ${product?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
              <button class="btn btn-outline" id="prod-new-category-btn" type="button" style="height:48px; width:48px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:12px; border:1.5px solid #e2e8f0; background:#f8fafc; color:var(--color-primary); cursor:pointer; transition: all 0.2s;" title="Nueva Categoría">
                ${icon('plus', 18)}
              </button>
            </div>
          </div>

          <div class="switch-container" style="margin-top:8px;">
            <div style="text-align:left;">
              <div style="font-size:13px; font-weight:750; color:var(--color-text-primary);">
                Disponible sólo en la app 
                <span id="prod-only-in-app-count-badge" style="font-size:11.5px; font-weight:800; color:${(panelFilteredProducts || []).filter(p => p.onlyInApp === true && (!product || p.id !== product.id)).length >= 3 ? 'var(--color-danger)' : 'var(--color-primary)'}; margin-left:4px;">
                  (${(panelFilteredProducts || []).filter(p => p.onlyInApp === true && (!product || p.id !== product.id)).length}/3 en uso)
                </span>
              </div>
              <div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">Producto o sabor exclusivo para usuarios de la App (máx. 3 por comercio).</div>
            </div>
            <label class="prod-switch" style="width:50px; height:28px; cursor:pointer; position:relative; display:inline-block; margin:0; flex-shrink:0;">
              <input type="checkbox" id="prod-only-in-app" ${product?.onlyInApp ? 'checked' : ''} style="opacity:0; width:0; height:0;" />
              <span class="prod-slider" style="position:absolute; inset:0; border-radius:34px; transition:0.2s; cursor:pointer;"></span>
            </label>
          </div>

          <!-- Stylish App-Exclusive Alert Banner -->
          <div id="prod-only-in-app-banner" style="display:${product?.onlyInApp ? 'flex' : 'none'}; background:linear-gradient(135deg, rgba(225,29,72,0.08) 0%, rgba(168,85,247,0.08) 100%); border:1.5px solid rgba(225,29,72,0.25); border-radius:14px; padding:14px; gap:12px; align-items:flex-start; margin-top:-4px; animation:fadeIn 0.3s ease-out;">
            <div style="width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg, var(--color-primary), #a855f7); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 4px 12px rgba(225,29,72,0.25);">
              ${icon('sparkles', 18)}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:12.5px; font-weight:900; color:var(--color-primary); display:flex; align-items:center; gap:6px;">
                <span>¡Exclusivo para la App!</span>
                <span style="font-size:9.5px; background:var(--color-primary); color:white; font-weight:800; padding:1px 6px; border-radius:6px; text-transform:uppercase;">Badge VIP</span>
              </div>
              <p style="font-size:11px; color:var(--color-text-secondary); margin:4px 0 0; line-height:1.45; font-weight:600;">
                Este producto <strong style="color:var(--color-text-primary);">únicamente podrá ser adquirido a través de la App móvil</strong> (no disponible de forma presencial o telefónica).
              </p>
              <div style="font-size:10.5px; color:var(--color-text-tertiary); margin-top:6px; font-style:italic;">
                💡 Ideal para: promociones especiales, sabores/combos exclusivos o descuentos de fidelización.
              </div>
            </div>
          </div>
        </div>

        <!-- Stock Card -->
        <div class="form-card" id="prod-stock-card" style="${isSoldByWeight(product) ? 'display:none;' : ''}">
          <div class="form-card-title">
            ${icon('package', 18)} Control de Stock
          </div>
          <div class="input-group" style="margin-bottom:12px;">
            <label>Modo de Inventario</label>
            <select class="input-premium" id="prod-stock-mode" style="background-image: none;">
              <option value="unlimited" ${product?.stockMode === 'unlimited' ? 'selected' : ''}>Ilimitado (Sin control)</option>
              <option value="limited" ${product?.stockMode === 'limited' || !product?.stockMode ? 'selected' : ''}>Limitado (Controlar cantidad)</option>
            </select>
          </div>
          <div id="prod-stock-fields" style="display:${product?.stockMode === 'unlimited' ? 'none' : 'grid'}; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="input-group">
              <label>Cantidad Disponible *</label>
              <input type="number" class="input-premium" id="prod-stock-quantity" value="${product?.stockQuantity !== undefined ? product.stockQuantity : ''}" placeholder="0" min="0" />
            </div>
            <div class="input-group">
              <label>Alerta Mínima</label>
              <input type="number" class="input-premium" id="prod-stock-threshold" value="${product?.stockThreshold !== undefined ? product.stockThreshold : '3'}" placeholder="3" min="0" />
            </div>
          </div>
        </div>

        <!-- Heladería / Comidas Flavors Card -->
        <div class="form-card">
          <div class="form-card-title">
            ${(comercioCategory || '').toLowerCase().includes('helad') ? '🍦 Configuración de Heladería' : '🍕 Gustos y Variedades'}
          </div>
          <div class="switch-container" style="margin-bottom:12px;">
            <div style="text-align:left;">
              <div style="font-size:13px; font-weight:750; color:var(--color-text-primary);">${(comercioCategory || '').toLowerCase().includes('helad') ? 'Vincular Sabores de Helado' : 'Vincular Gustos/Rellenos'}</div>
              <div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">${(comercioCategory || '').toLowerCase().includes('helad') ? 'Carga automáticamente los sabores activos del gestor' : 'Carga automáticamente los gustos activos del gestor'}</div>
            </div>
            <label class="prod-switch" style="width:50px; height:28px; cursor:pointer; position:relative; display:inline-block; margin:0; flex-shrink:0;">
              <input type="checkbox" id="prod-use-global-flavors" ${product?.useGlobalFlavors ? 'checked' : ''} style="opacity:0; width:0; height:0;" />
              <span class="prod-slider" style="position:absolute; inset:0; border-radius:34px; transition:0.2s; cursor:pointer;"></span>
            </label>
          </div>
          <div id="prod-flavors-limit-field" style="display:${product?.useGlobalFlavors ? 'block' : 'none'};">
            <div class="input-group">
              <label>${(comercioCategory || '').toLowerCase().includes('helad') ? 'Límite de sabores (máx. permitido) *' : 'Límite de gustos/variedades (máx. permitido) *'}</label>
              <input type="number" class="input-premium" id="prod-flavors-max" value="${product?.maxSelections || ''}" placeholder="${(comercioCategory || '').toLowerCase().includes('helad') ? 'Ej: 4' : 'Ej: 12'}" min="1" />
            </div>

            <div class="input-group" style="margin-top:16px;">
              <label style="margin-bottom:8px;">Sabores disponibles para este producto</label>
              <div style="font-size:11px; color:var(--color-text-secondary); margin-bottom:8px;">Selecciona el grupo y tilda los sabores que aplican a este producto.</div>
              
              <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
                <select id="prod-flavors-category-filter" class="input-premium" style="flex:1; background-image:none;">
                  <option value="all">Ver todos los sabores mezclados</option>
                  ${[...new Set((panelComercioData?.sabores || []).map(s => s.category || 'Otros'))].sort().map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                </select>
                <button type="button" id="btn-select-all-flavors" style="padding:0 10px; height:42px; border-radius:10px; background:var(--color-bg-secondary); border:1px solid var(--color-border); font-size:11px; font-weight:700; color:var(--color-primary); cursor:pointer; white-space:nowrap;">Marcar Visibles</button>
                <button type="button" id="btn-deselect-all-flavors" style="padding:0 10px; height:42px; border-radius:10px; background:var(--color-bg-secondary); border:1px solid var(--color-border); font-size:11px; font-weight:700; color:var(--color-text-secondary); cursor:pointer; white-space:nowrap;">Desmarcar</button>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px; background:var(--color-surface); padding:12px; border-radius:8px; border:1px solid var(--color-border-light); max-height:200px; overflow-y:auto;" id="prod-flavors-checklist">
                ${(panelComercioData?.sabores || []).map(s => `
                  <label class="prod-flavor-item" data-category="${s.category || 'Otros'}" style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;" title="${s.name}">
                    <input type="checkbox" class="prod-flavor-checkbox" value="${s.name}" ${(product?.allowedFlavors && product.allowedFlavors.includes(s.name)) ? 'checked' : ''} />
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.name}</span>
                  </label>
                `).join('')}
                ${!(panelComercioData?.sabores || []).length ? '<div style="font-size:12px; color:var(--color-text-tertiary); grid-column:1/-1;">No hay sabores creados en el Gestor.</div>' : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Custom Options Card -->
        <div class="form-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div class="form-card-title" style="margin-bottom:0;">
              ${icon('settings', 18)} Otras Opciones y Extras
            </div>
            <button class="btn btn-sm btn-outline" id="add-option-group" style="border-radius: 8px; border:1.5px solid #cbd5e1; background: #ffffff; color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s;">
              ${icon('plus', 14)} Nuevo Grupo
            </button>
          </div>
          <div id="prod-options-groups"></div>
        </div>
      </div>
    `,
    footer: `
      ${product && onDelete ? `<button class="btn btn-ghost" id="prod-delete" style="color:var(--go-red); margin-right:auto">${icon('trash', 16)} Eliminar</button>` : ''}
      <button class="btn btn-ghost" id="prod-cancel">Cancelar</button>
      <button class="btn btn-primary" id="prod-save">Guardar</button>
    `
  });
  document.getElementById('prod-delete')?.addEventListener('click', () => { closeModal(); onDelete(product); });

  // Options Management
  let optionsGroups = JSON.parse(JSON.stringify(product?.optionsGroups || []));

  const renderOptionsGroups = () => {
    const container = document.getElementById('prod-options-groups');
    if (!container) return;

    if (optionsGroups.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:var(--space-4); color:var(--color-text-tertiary); font-size:var(--font-sm); border:1px dashed var(--color-border); border-radius:var(--radius-lg);">Sin opciones configuradas</div>`;
      return;
    }

    container.innerHTML = optionsGroups.map((group, gIdx) => `
      <div class="option-group-editor" style="background:var(--color-bg-secondary); border-radius:var(--radius-lg); padding:var(--space-4); margin-bottom:var(--space-4); border:1px solid var(--color-border-light);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-3);">
          <div style="font-weight:bold; font-size:var(--font-sm); color:var(--color-primary);">GRUPO #${gIdx + 1}</div>
          <button class="btn btn-sm btn-ghost" data-action="remove-group" data-idx="${gIdx}">${icon('trash', 16)}</button>
        </div>
        
        <div class="input-group" style="margin-bottom:var(--space-3);">
          <label style="font-size:var(--font-xs);">Nombre del Grupo</label>
          <input type="text" class="input group-name-input" data-idx="${gIdx}" value="${group.name || ''}" placeholder="Ej: Presentación" />
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:var(--space-4); margin-bottom:var(--space-4); align-items:center;">
          <label style="display:flex; align-items:center; gap:var(--space-2); font-size:var(--font-xs); cursor:pointer;">
            <input type="checkbox" class="group-required-input" data-idx="${gIdx}" ${group.required ? 'checked' : ''} /> Obligatorio
          </label>
          <label style="display:flex; align-items:center; gap:var(--space-2); font-size:var(--font-xs); cursor:pointer;">
            <input type="checkbox" class="group-multi-input" data-idx="${gIdx}" ${group.multi ? 'checked' : ''} /> Multiselección
          </label>
          <label style="display:flex; align-items:center; gap:var(--space-2); font-size:var(--font-xs); cursor:pointer;" title="Si se marca, el precio de la opción seleccionada reemplaza al precio base del producto.">
            <input type="checkbox" class="group-pricemode-input" data-idx="${gIdx}" ${group.priceMode === 'replace' ? 'checked' : ''} /> Reemplazar precio base
          </label>
          ${group.multi ? `
            <div style="display:flex; align-items:center; gap:6px; margin-left:var(--space-2);">
              <span style="font-size:10px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Máx:</span>
              <input type="number" class="input group-max-input" data-idx="${gIdx}" value="${group.maxSelections || ''}" placeholder="Sin límite" style="width:70px; min-height:30px; height:30px; font-size:12px; padding:0 8px; text-align:center; border:1px solid var(--color-border-light); border-radius:8px;" min="1" />
            </div>
          ` : ''}
        </div>

        <div style="background:var(--color-surface); padding:var(--space-3); border-radius:var(--radius-md);">
          <label style="font-size:var(--font-xs); font-weight:bold; color:var(--color-text-secondary); display:block; margin-bottom:var(--space-2);">OPCIONES</label>
          <div class="options-editor-list">
            ${(group.options || []).map((opt, oIdx) => `
              <div style="display:flex; flex-wrap:wrap; gap:var(--space-2); margin-top:var(--space-3); padding-bottom:var(--space-3); border-bottom:1px solid var(--color-border-light); align-items:flex-end;">
                <div style="flex:1 1 100%; display:flex; gap:var(--space-2); align-items:flex-end;">
                  <div style="flex:1; min-width:0;">
                    <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase;">Nombre</span>
                    <input type="text" class="input opt-name-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.name || ''}" placeholder="Ej: Cheddar" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-3); width:100%; box-sizing:border-box;" />
                  </div>
                  <button class="btn btn-sm btn-ghost" data-action="remove-option" data-gidx="${gIdx}" data-oidx="${oIdx}" style="min-width:36px; height:36px; color:var(--color-text-tertiary); margin-bottom:1px;">${icon('close', 14)}</button>
                </div>
                <div style="flex:1 1 100%; display:flex; gap:var(--space-2); align-items:flex-end;">
                  <div style="flex:1.5; min-width:0;">
                    <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase;">Precio</span>
                    <input type="number" class="input opt-price-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.price || ''}" placeholder="0" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-2); width:100%; box-sizing:border-box;" />
                  </div>
                  <div style="flex:1; min-width:0;">
                    <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase;">Máx</span>
                    <input type="number" class="input opt-maxqty-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.maxQty || 1}" placeholder="1" min="1" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-2); text-align:center; width:100%; box-sizing:border-box;" />
                  </div>
                  <div style="flex:1.2; min-width:0;">
                    <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase; display:flex; align-items:center; gap:4px;" title="Multiplicador de Stock">
                      Stock (x)
                      <button type="button" onclick="alert('Esta es la cantidad de unidades físicas que se descontarán de tu inventario o del sabor cuando el cliente seleccione esta opción. Ejemplo: Si la opción es Media Docena, pon 6.')" style="border:none; padding:0; background:none; cursor:pointer; color:var(--color-primary); display:flex; align-items:center;">${icon('info', 12)}</button>
                    </span>
                    <input type="number" class="input opt-stockmult-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.stockMultiplier || 1}" placeholder="1" min="1" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-2); text-align:center; width:100%; box-sizing:border-box;" />
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-sm btn-ghost btn-block" data-action="add-option" data-idx="${gIdx}" style="margin-top:var(--space-3); border:1px dashed var(--color-border);">
            ${icon('plus', 14)} Agregar opción
          </button>
        </div>
      </div>
    `).join('');

    // Listeners for groups
    container.querySelectorAll('.group-name-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.idx].name = input.value; };
    });
    container.querySelectorAll('.group-required-input').forEach(input => {
      input.onchange = () => { optionsGroups[input.dataset.idx].required = input.checked; };
    });
    container.querySelectorAll('.group-multi-input').forEach(input => {
      input.onchange = () => {
        optionsGroups[input.dataset.idx].multi = input.checked;
        if (!input.checked) {
          delete optionsGroups[input.dataset.idx].maxSelections;
        }
        renderOptionsGroups();
      };
    });
    container.querySelectorAll('.group-max-input').forEach(input => {
      input.oninput = () => {
        const val = parseInt(input.value);
        if (!isNaN(val) && val > 0) {
          optionsGroups[input.dataset.idx].maxSelections = val;
        } else {
          delete optionsGroups[input.dataset.idx].maxSelections;
        }
      };
    });
    container.querySelectorAll('.group-pricemode-input').forEach(input => {
      input.onchange = () => { optionsGroups[input.dataset.idx].priceMode = input.checked ? 'replace' : 'add'; };
    });
    container.querySelectorAll('.opt-name-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].name = input.value; };
    });
    container.querySelectorAll('.opt-price-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].price = parseFloat(input.value) || 0; };
    });
    container.querySelectorAll('.opt-maxqty-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].maxQty = parseInt(input.value) || 1; };
    });
    container.querySelectorAll('.opt-stockmult-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].stockMultiplier = parseInt(input.value) || 1; };
    });

    // Remove group
    container.querySelectorAll('[data-action="remove-group"]').forEach(btn => {
      btn.onclick = () => {
        optionsGroups.splice(btn.dataset.idx, 1);
        renderOptionsGroups();
      };
    });

    // Add option
    container.querySelectorAll('[data-action="add-option"]').forEach(btn => {
      btn.onclick = () => {
        optionsGroups[btn.dataset.idx].options.push({ name: '', price: 0, stockMultiplier: 1 });
        renderOptionsGroups();
      };
    });

    // Remove option
    container.querySelectorAll('[data-action="remove-option"]').forEach(btn => {
      btn.onclick = () => {
        optionsGroups[btn.dataset.gidx].options.splice(btn.dataset.oidx, 1);
        renderOptionsGroups();
      };
    });
  };

  setTimeout(renderOptionsGroups, 100);

  document.getElementById('add-option-group')?.addEventListener('click', () => {
    optionsGroups.push({ name: '', required: false, multi: false, priceMode: 'add', options: [{ name: '', price: 0, maxQty: 1, stockMultiplier: 1 }] });
    renderOptionsGroups();
  });

  // Reactive Only In App Toggle
  document.getElementById('prod-only-in-app')?.addEventListener('change', (e) => {
    const banner = document.getElementById('prod-only-in-app-banner');
    if (banner) {
      banner.style.display = e.target.checked ? 'flex' : 'none';
    }
  });

  // Por peso: precio por kilo, paso en gramos y sin control de stock (la cantidad son pasos, no unidades)
  document.getElementById('prod-sold-by-weight')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    document.getElementById('prod-weight-fields').style.display = on ? 'flex' : 'none';
    document.getElementById('prod-price-label').textContent = on ? 'Precio por kilo ($) *' : 'Precio de Venta ($) *';
    document.getElementById('prod-stock-card').style.display = on ? 'none' : '';
  });

  // Reactive Stock Fields Toggle
  document.getElementById('prod-stock-mode')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    const fields = document.getElementById('prod-stock-fields');
    if (fields) {
      fields.style.display = mode === 'limited' ? 'grid' : 'none';
    }
  });

  // Reactive Global Flavors Toggle
  const updateFlavorsStockSum = () => {
    const stockQuantityField = document.getElementById('prod-stock-quantity');
    if (!stockQuantityField) return;
    
    const checkedCheckboxes = Array.from(document.querySelectorAll('.prod-flavor-checkbox:checked')).map(cb => cb.value);
    
    let total = 0;
    let hasInfiniteStock = false;
    
    if (panelComercioData && panelComercioData.sabores) {
      const activeFlavors = checkedCheckboxes.length > 0 
        ? panelComercioData.sabores.filter(s => checkedCheckboxes.includes(s.name))
        : panelComercioData.sabores;
        
      // Note: s.isAvailable means "is stock limited?". So !s.isAvailable means infinite stock.
      hasInfiniteStock = activeFlavors.some(s => !s.isAvailable || s.stock === undefined || s.stock === null || s.stock === '');
      
      if (!hasInfiniteStock) {
        total = activeFlavors.reduce((sum, s) => sum + (parseInt(s.stock) || 0), 0);
      }
    }
    
    if (hasInfiniteStock) {
      stockQuantityField.value = '';
      stockQuantityField.type = 'text'; // change temporarily to show infinity symbol easily if we want, or just placeholder
      stockQuantityField.placeholder = '∞';
    } else {
      stockQuantityField.type = 'number';
      stockQuantityField.value = total;
      stockQuantityField.placeholder = 'Ej: 50';
    }
  };

  const toggleGlobalFlavors = (isChecked) => {
    const limitField = document.getElementById('prod-flavors-limit-field');
    const stockQuantityField = document.getElementById('prod-stock-quantity');
    
    if (limitField) {
      limitField.style.display = isChecked ? 'block' : 'none';
    }
    
    if (isChecked && stockQuantityField) {
      updateFlavorsStockSum();
      stockQuantityField.setAttribute('readonly', 'readonly');
      stockQuantityField.style.opacity = '0.6';
      stockQuantityField.title = "El stock se calcula automáticamente sumando el stock de los sabores seleccionados.";
    } else if (stockQuantityField) {
      stockQuantityField.removeAttribute('readonly');
      stockQuantityField.style.opacity = '1';
      stockQuantityField.title = "";
    }
  };

  document.getElementById('prod-use-global-flavors')?.addEventListener('change', (e) => {
    toggleGlobalFlavors(e.target.checked);
  });
  
  document.querySelectorAll('.prod-flavor-checkbox').forEach(cb => {
    cb.addEventListener('change', updateFlavorsStockSum);
  });
  
  document.getElementById('prod-flavors-category-filter')?.addEventListener('change', (e) => {
    const selectedCat = e.target.value;
    document.querySelectorAll('.prod-flavor-item').forEach(el => {
      const isMatch = selectedCat === 'all' || el.dataset.category === selectedCat;
      el.style.display = isMatch ? 'flex' : 'none';
    });

    // Auto-check visible category flavors if no flavors in this category were explicitly checked yet
    if (selectedCat !== 'all') {
      const catCheckboxes = Array.from(document.querySelectorAll(`.prod-flavor-item[data-category="${CSS.escape(String(selectedCat))}"] .prod-flavor-checkbox`));
      const hasAnyChecked = catCheckboxes.some(cb => cb.checked);
      if (!hasAnyChecked) {
        catCheckboxes.forEach(cb => { cb.checked = true; });
        updateFlavorsStockSum();
      }
    }
  });

  document.getElementById('btn-select-all-flavors')?.addEventListener('click', () => {
    document.querySelectorAll('.prod-flavor-item').forEach(el => {
      if (el.style.display !== 'none') {
        const cb = el.querySelector('.prod-flavor-checkbox');
        if (cb) cb.checked = true;
      }
    });
    updateFlavorsStockSum();
  });

  document.getElementById('btn-deselect-all-flavors')?.addEventListener('click', () => {
    document.querySelectorAll('.prod-flavor-item').forEach(el => {
      if (el.style.display !== 'none') {
        const cb = el.querySelector('.prod-flavor-checkbox');
        if (cb) cb.checked = false;
      }
    });
    updateFlavorsStockSum();
  });
  
  // Initialize on open
  if (product?.useGlobalFlavors) {
    toggleGlobalFlavors(true);
    const filter = document.getElementById('prod-flavors-category-filter');
    if (filter) {
      filter.value = 'all';
      filter.dispatchEvent(new Event('change'));
    }
  }

  // Inline Category Creation
  document.getElementById('prod-new-category-btn')?.addEventListener('click', () => {
    showModal({
      title: 'Nueva Categoría',
      height: 'auto',
      content: `
        <div class="panel-form" style="padding: 20px;">
          <div class="input-group">
            <label>Nombre de la Categoría *</label>
            <input type="text" class="input" id="new-cat-name" placeholder="Ej: Hamburguesas, Bebidas" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="new-cat-cancel">Cancelar</button>
        <button class="btn btn-primary" id="new-cat-save">Crear</button>
      `
    });

    document.getElementById('new-cat-cancel')?.addEventListener('click', () => closeModal());
    
    document.getElementById('new-cat-save')?.addEventListener('click', async () => {
      const catName = document.getElementById('new-cat-name')?.value.trim();
      if (!catName) {
        showToast('Ingresá un nombre para la categoría', 'warning');
        return;
      }

      const saveBtn = document.getElementById('new-cat-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Creando...';

      try {
        console.log('[Category] Initializing creation for:', catName);
        const nextOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order || 0)) + 1 : 0;
        const newCatRef = doc(collection(db, 'comercios', comercioId, 'categories'));
        const newCatData = {
          name: catName,
          order: nextOrder,
          createdAt: new Date()
        };

        console.log('[Category] Writing to Firestore...', newCatData);
        await setDoc(newCatRef, newCatData);
        console.log('[Category] Firestore write successful. Document ID:', newCatRef.id);

        const newCategory = { id: newCatRef.id, ...newCatData };
        categories.push(newCategory);

        // Re-render select inside product modal
        const select = document.getElementById('prod-category');
        if (select) {
          select.innerHTML = `
            <option value="">Sin categoría</option>
            ${categories.map(c => `<option value="${c.id}" ${newCategory.id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          `;
          select.value = newCategory.id;
        }

        // Hot-reload filter tabs in background
        if (onCategoryAdded) {
          try {
            onCategoryAdded(newCategory);
          } catch (e) {
            console.error('[Category] Error in onCategoryAdded callback:', e);
          }
        }

        console.log('[Category] Closing modal and showing toast...');
        closeModal();
        showToast('Categoría creada', 'success');
      } catch (err) {
        console.error('[Category] Error creating category:', err);
        showToast('Error al crear categoría: ' + (err.message || 'Desconocido'), 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Crear';
      }
    });
  });

  // Image upload with Cropper
  document.getElementById('prod-image-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 4 / 3 });
        croppedImage = cropped;
        const preview = document.getElementById('prod-image-preview');
        const placeholder = document.getElementById('prod-image-placeholder');
        if (preview) {
          preview.src = cropped;
          preview.style.display = 'block';
          preview.style.opacity = '1';
        }
        if (placeholder) {
          placeholder.style.display = 'none';
        }
      } catch (err) {
        console.log('Cropping cancelled or failed');
      }
    }
  });

  const appOnlyCb = document.getElementById('prod-only-in-app');
  const appOnlyBanner = document.getElementById('prod-only-in-app-banner');
  if (appOnlyCb) {
    appOnlyCb.addEventListener('change', (e) => {
      const currentCount = (panelFilteredProducts || []).filter(p => p.onlyInApp === true && (!product || p.id !== product.id)).length;
      if (e.target.checked) {
        if (currentCount >= 3) {
          e.target.checked = false;
          if (appOnlyBanner) appOnlyBanner.style.display = 'none';
          showToast('Límite alcanzado: Cada comercio solo puede tener hasta 3 productos disponibles "Solo en la app".', 'warning');
          return;
        }
        if (appOnlyBanner) appOnlyBanner.style.display = 'flex';
      } else {
        if (appOnlyBanner) appOnlyBanner.style.display = 'none';
      }
    });
  }

  document.getElementById('prod-name-from-ventra')?.addEventListener('click', (e) => {
    const input = document.getElementById('prod-name');
    if (input && product?.ventraName) input.value = product.ventraName;
    e.currentTarget.remove();
  });
  document.getElementById('prod-cancel')?.addEventListener('click', closeModal);
  document.getElementById('prod-save')?.addEventListener('click', async () => {
    const name = document.getElementById('prod-name')?.value.trim();
    const barcode = document.getElementById('prod-barcode')?.value.trim() || '';
    const desc = document.getElementById('prod-desc')?.value.trim();
    const price = parseFloat(document.getElementById('prod-price')?.value);
    const categoryId = document.getElementById('prod-category')?.value;

    if (!name) { showToast('Ingresá un nombre', 'warning'); return; }
    if (!price || price <= 0) { showToast('Ingresá un precio válido', 'warning'); return; }
    if (!product && !croppedImage) { showToast('Es obligatorio subir una imagen para crear el producto', 'warning'); return; }

    const onlyInApp = document.getElementById('prod-only-in-app')?.checked || false;
    if (onlyInApp) {
      const currentCount = (panelFilteredProducts || []).filter(p => p.onlyInApp === true && (!product || p.id !== product.id)).length;
      if (currentCount >= 3) {
        showToast('Límite alcanzado: Cada comercio solo puede tener hasta 3 productos disponibles "Solo en la app".', 'warning');
        return;
      }
    }

    const soldByWeight = document.getElementById('prod-sold-by-weight')?.checked || false;
    const weightStep = Number(document.getElementById('prod-weight-step')?.value) || weightStepOf(null);
    const stockMode = soldByWeight ? 'unlimited' : (document.getElementById('prod-stock-mode')?.value || 'unlimited');
    let stockQuantity = 0;
    let stockThreshold = 3;

    const useGlobalFlavors = document.getElementById('prod-use-global-flavors')?.checked || false;
    let maxSelections = null;
    let allowedFlavors = [];
    if (useGlobalFlavors) {
      maxSelections = parseInt(document.getElementById('prod-flavors-max')?.value) || 4;
      allowedFlavors = Array.from(document.querySelectorAll('.prod-flavor-checkbox:checked')).map(cb => cb.value);
    }

    if (stockMode === 'limited' && !useGlobalFlavors) {
      const qtyInput = document.getElementById('prod-stock-quantity')?.value;
      if (qtyInput === undefined || qtyInput === null || qtyInput.trim() === '') {
        showToast('Ingresá la cantidad disponible en stock', 'warning');
        return;
      }
      stockQuantity = parseInt(qtyInput);
      if (isNaN(stockQuantity) || stockQuantity < 0) {
        showToast('La cantidad de stock no puede ser negativa', 'warning');
        return;
      }
      const thresholdInput = document.getElementById('prod-stock-threshold')?.value;
      stockThreshold = thresholdInput !== '' ? parseInt(thresholdInput) : 3;
      if (isNaN(stockThreshold) || stockThreshold < 0) {
        showToast('La alerta de stock mínimo no puede ser negativa', 'warning');
        return;
      }
    } else if (stockMode === 'limited' && useGlobalFlavors) {
      // If using global flavors, the stock is handled by the flavors system
      stockQuantity = null; 
      const thresholdInput = document.getElementById('prod-stock-threshold')?.value;
      stockThreshold = thresholdInput !== '' ? parseInt(thresholdInput) : 3;
    }
    
    const saveBtn = document.getElementById('prod-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {

      const currentExistingImage = product ? (product.image || product.imageUrl || '') : '';
      const pendingImage = (croppedImage && typeof croppedImage === 'string' && croppedImage.trim() !== '')
        ? croppedImage
        : currentExistingImage;

      const productRef = product
        ? doc(db, 'comercios', comercioId, 'products', product.id)
        : doc(collection(db, 'comercios', comercioId, 'products'));

      const savedImage = await uploadDataUrlImage(pendingImage, `products/${comercioId}/${productRef.id}`);

      const isAvailableToggle = document.getElementById('prod-status-toggle');
      const isAvailable = isAvailableToggle ? isAvailableToggle.checked : (product ? product.isAvailable !== false : true);

      const rawCost = document.getElementById('prod-cost-price')?.value;
      const costPrice = rawCost !== undefined && rawCost !== '' ? parseFloat(rawCost) : 0;

      // Producto de Ventra: si el dueño le cambió el nombre o lo ocultó acá, Ventra ya no lo pisa
      const ventraFlags = product?.source === 'ventra' ? {
        // Sin cambios queda como estaba; volver al nombre de la caja lo destraba
        nameLockedInGo: name === product.name ? product.nameLockedInGo === true : !(product.ventraName && name === product.ventraName),
        hiddenInGo: !isAvailable,
      } : {};
      const productData = {
        ...ventraFlags,
        name,
        barcode,
        description: desc,
        price,
        costPrice: isNaN(costPrice) ? 0 : costPrice,
        categoryId: categoryId || '',
        image: savedImage,
        imageUrl: savedImage,
        optionsGroups: optionsGroups.filter(g => g.name.trim() !== ''),
        isAvailable,
        stockMode,
        stockQuantity,
        stockThreshold,
        useGlobalFlavors,
        maxSelections,
        allowedFlavors,
        selectedFlavorCategory: document.getElementById('prod-flavors-category-filter')?.value || 'all',
        flavorCategory: document.getElementById('prod-flavors-category-filter')?.value || 'all',
        onlyInApp,
        soldByWeight,
        weightStep: soldByWeight ? weightStep : null,
        order: product?.order || 0,
        createdAt: product?.createdAt || new Date()
      };

      let firestoreDocId = product ? product.id : null;

      const doSaveCloud = async () => {
        if (product) {
          await updateDoc(productRef, productData);
          onSave({ id: product.id, ...productData });
        } else {
          await setDoc(productRef, productData);
          firestoreDocId = productRef.id;
          onSave({ id: productRef.id, ...productData });
        }
      };

      const doSaveLocalSync = async () => {
        try {
          const res = await fetch('http://localhost:3001/api/sync/product', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-sync-token': 'paulos-local-sync-token-secret-2026'
            },
            body: JSON.stringify({
              godeliveryId: firestoreDocId,
              barcode: barcode,
              name: name,
              salePrice: price,
              stock: stockMode === 'limited' ? stockQuantity : undefined,
              description: desc || ''
            })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || 'Error del POS local');
          }
        } catch (err) {
          console.error('Error in local sync fetch (server offline):', err);
          showToast('Kiosco POS local desconectado. Los cambios se guardaron online y se sincronizarán al iniciar GoPortal.', 'info');
        }
      };

      if (barcode && isSyncAllowed) {
        showSyncConfirm({
          title: 'Sincronizar Cambios',
          message: `¿Querés guardar "${name}" únicamente en la tienda online GoDelivery, o también sincronizarlo en tiempo real con tu sistema local Kiosco POS?`,
          onSyncBoth: async () => {
            await doSaveCloud();
            await doSaveLocalSync();
            closeModal();
            showToast('Producto actualizado en GoDelivery y Kiosco POS', 'success');
          },
          onSyncOnlyCloud: async () => {
            await doSaveCloud();
            closeModal();
            showToast('Producto guardado solo en GoDelivery (Online)', 'success');
          },
          onCancel: () => {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar';
          }
        });
      } else {
        await doSaveCloud();
        closeModal();
        showToast(product ? 'Producto actualizado' : 'Producto creado', 'success');
      }
    } catch (e) {
      console.error('Error saving product:', e);
      showToast('Error al guardar: ' + e.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  });
}

function showSyncConfirm({ title, message, onSyncBoth, onSyncOnlyCloud, onCancel }) {
  const uid = Math.random().toString(36).substr(2, 5);
  const cancelId = `sync-cancel-${uid}`;
  const onlyCloudId = `sync-only-cloud-${uid}`;
  const bothId = `sync-both-${uid}`;

  let hasResponded = false;

  showModal({
    title: title || 'Sincronizar Cambios',
    height: 'auto',
    content: `
      <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
        <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(34, 197, 94, 0.1); display: flex; align-items: center; justify-content: center; color: #22C55E;">
          ${icon('refresh', 28)}
        </div>
        <div style="font-weight: 800; font-size: 18px; color: var(--color-text-primary);">${title || 'Sincronización POS'}</div>
        <p style="color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; margin: 0; font-weight: 500;">
          ${message}
        </p>
      </div>
    `,
    footer: `
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; padding: 0 4px 8px 4px;">
        <button class="btn btn-primary" id="${bothId}" style="height: 52px; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${icon('refresh', 16)} Sincronizar en Ambos Sistemas
        </button>
        <button class="btn btn-outline" id="${onlyCloudId}" style="height: 52px; border-radius: 14px; font-weight: 800; font-size: 14px; background: transparent; border: 1.5px solid var(--color-border); color: var(--color-text-primary);">
          Solo en GoDelivery (Online)
        </button>
        <button class="btn btn-ghost" id="${cancelId}" style="height: 44px; border-radius: 12px; font-weight: 700; font-size: 13px; color: var(--color-text-tertiary);">
          Cancelar
        </button>
      </div>
    `,
    onClose: () => {
      if (!hasResponded && onCancel) {
        onCancel();
      }
    }
  });

  document.getElementById(cancelId)?.addEventListener('click', () => {
    hasResponded = true;
    closeModal();
    if (onCancel) onCancel();
  });

  document.getElementById(onlyCloudId)?.addEventListener('click', async () => {
    hasResponded = true;
    const btn = document.getElementById(onlyCloudId);
    const bothBtn = document.getElementById(bothId);
    const cancelBtn = document.getElementById(cancelId);
    if (btn) btn.disabled = true;
    if (bothBtn) bothBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    
    try {
      await onSyncOnlyCloud();
      closeModal();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (bothBtn) bothBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });

  document.getElementById(bothId)?.addEventListener('click', async () => {
    hasResponded = true;
    const btn = document.getElementById(bothId);
    const cloudBtn = document.getElementById(onlyCloudId);
    const cancelBtn = document.getElementById(cancelId);
    if (btn) btn.disabled = true;
    if (cloudBtn) cloudBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      await onSyncBoth();
      closeModal();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (cloudBtn) cloudBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });
}

function showBulkPriceIncreaseModal(products, categories, comercioId, onComplete) {
  showModal({
    title: '📈 Aumento / Recargo Masivo',
    headerBackground: 'var(--color-primary)',
    headerTextColor: '#ffffff',
    content: `
      <div style="display:flex; flex-direction:column; gap:16px; padding:12px 16px 20px 16px;">
        <div style="background:linear-gradient(135deg, rgba(225,29,72,0.08), rgba(225,29,72,0.02)); border:1px solid rgba(225,29,72,0.2); border-radius:14px; padding:12px 14px; display:flex; align-items:center; gap:10px;">
          <div style="width:34px; height:34px; border-radius:10px; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${icon('percent', 18)}
          </div>
          <p style="font-size:11.5px; color:var(--color-text-primary); margin:0; line-height:1.4; font-weight:600;">
            Aumentá precios en lote de forma automática por porcentaje o monto fijo en toda tu carta o por categoría.
          </p>
        </div>

        <div class="input-group">
          <label style="font-size:11.5px; font-weight:850; text-transform:uppercase; letter-spacing:0.4px; color:var(--color-text-secondary);">Categoría Objetivo</label>
          <select id="bulk-category-select" class="input-premium" style="height:46px; background:#f8fafc; border-radius:12px; font-weight:700; font-size:13px;">
            <option value="all">⚡ Todos los productos (${products.length})</option>
            ${categories.map(c => {
              const count = products.filter(p => p.categoryId === c.id).length;
              return `<option value="${c.id}">📦 ${c.name} (${count} prod)</option>`;
            }).join('')}
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="input-group">
            <label style="font-size:11.5px; font-weight:850; text-transform:uppercase; letter-spacing:0.4px; color:var(--color-text-secondary);">Tipo de Recargo</label>
            <select id="bulk-type-select" class="input-premium" style="height:46px; background:#f8fafc; border-radius:12px; font-weight:700; font-size:13px;">
              <option value="percentage">Porcentaje (%)</option>
              <option value="fixed">Monto Fijo ($)</option>
            </select>
          </div>
          <div class="input-group">
            <label style="font-size:11.5px; font-weight:850; text-transform:uppercase; letter-spacing:0.4px; color:var(--color-text-secondary);">Valor del Aumento</label>
            <input type="number" id="bulk-value-input" class="input-premium" style="height:46px; background:#f8fafc; border-radius:12px; font-weight:800; font-size:14px;" placeholder="ej: 10 o 500" value="10" min="0.1" step="any" />
          </div>
        </div>

        <div style="background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:14px; padding:12px 14px; display:flex; align-items:center; gap:10px;">
          <input type="checkbox" id="bulk-round-checkbox" checked style="width:18px; height:18px; accent-color:var(--color-primary); cursor:pointer;" />
          <label for="bulk-round-checkbox" style="font-size:12px; font-weight:750; color:var(--color-text-primary); cursor:pointer; user-select:none;">Redondear precios a múltiplos de $50 (ej: $14.050)</label>
        </div>

        <div style="background:rgba(225,29,72,0.06); border:1px solid rgba(225,29,72,0.2); border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:4px;">
          <span style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--color-primary); letter-spacing:0.6px;">Simulación de Precios:</span>
          <span id="bulk-preview-text" style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); line-height:1.3;">...</span>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="bulk-cancel-btn" style="flex:1; border-radius:12px; font-weight:800;">Cancelar</button>
      <button class="btn btn-primary" id="bulk-apply-btn" style="flex:1; border-radius:12px; font-weight:900;">Aplicar Aumento</button>
    `
  });

  const catSelect = document.getElementById('bulk-category-select');
  const typeSelect = document.getElementById('bulk-type-select');
  const valInput = document.getElementById('bulk-value-input');
  const roundCheck = document.getElementById('bulk-round-checkbox');
  const previewText = document.getElementById('bulk-preview-text');
  const applyBtn = document.getElementById('bulk-apply-btn');

  const updatePreview = () => {
    const targetCat = catSelect.value;
    const type = typeSelect.value;
    const val = parseFloat(valInput.value) || 0;
    const shouldRound = roundCheck.checked;

    const targetProds = targetCat === 'all' ? products : products.filter(p => p.categoryId === targetCat);
    if (targetProds.length === 0) {
      previewText.textContent = 'No hay productos en la categoría seleccionada.';
      return;
    }

    const sample = targetProds[0];
    let newPrice = sample.price || 0;
    if (type === 'percentage') {
      newPrice = newPrice * (1 + val / 100);
    } else {
      newPrice = newPrice + val;
    }

    if (shouldRound) {
      newPrice = Math.ceil(newPrice / 50) * 50;
    }

    previewText.textContent = `Afectará a ${targetProds.length} productos. Ej: "${sample.name}" de ${formatPrice(sample.price)} pasa a ${formatPrice(newPrice)}.`;
  };

  catSelect.onchange = updatePreview;
  typeSelect.onchange = updatePreview;
  valInput.oninput = updatePreview;
  roundCheck.onchange = updatePreview;

  updatePreview();

  document.getElementById('bulk-cancel-btn').onclick = () => closeModal();

  applyBtn.onclick = async () => {
    const targetCat = catSelect.value;
    const type = typeSelect.value;
    const val = parseFloat(valInput.value) || 0;
    const shouldRound = roundCheck.checked;

    if (val <= 0) {
      showToast('Ingresá un valor de aumento válido', 'warning');
      return;
    }

    const targetProds = targetCat === 'all' ? products : products.filter(p => p.categoryId === targetCat);
    if (targetProds.length === 0) {
      showToast('No hay productos para actualizar', 'warning');
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Aplicando...';

    try {
      const batch = writeBatch(db);
      for (const prod of targetProds) {
        let newPrice = prod.price || 0;
        if (type === 'percentage') {
          newPrice = newPrice * (1 + val / 100);
        } else {
          newPrice = newPrice + val;
        }

        if (shouldRound) {
          newPrice = Math.ceil(newPrice / 50) * 50;
        }

        newPrice = Math.max(0, Math.round(newPrice));

        const prodRef = doc(db, 'comercios', comercioId, 'products', prod.id);
        batch.update(prodRef, { price: newPrice });

        prod.price = newPrice;
      }

      await batch.commit();
      closeModal();
      showToast(`¡Se aumentó el precio de ${targetProds.length} productos!`, 'success');
      onComplete();
    } catch (err) {
      console.error('Error applying bulk price increase:', err);
      showToast('Error al aplicar aumento masivo', 'error');
      applyBtn.disabled = false;
      applyBtn.textContent = 'Aplicar Aumento';
    }
  };
}
