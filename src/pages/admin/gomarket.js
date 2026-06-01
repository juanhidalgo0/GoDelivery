// GoDelivery — Admin GoMarket Configuration
import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';

export async function renderAdminGoMarket() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <button onclick="location.hash='#/admin'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Configurar GoMarket</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Tienda Oficial de la Plataforma</p>
        </div>
      </div>

      <div id="gomarket-config-container" style="flex:1; overflow-y:auto; padding:20px; -webkit-overflow-scrolling:touch;">
        <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;

  try {
    const snap = await getDocs(collection(db, 'comercios'));
    const goMarket = snap.docs.find(d => {
      const name = (d.data().name || '').toLowerCase();
      return name.includes('go!') && name.includes('market');
    });

    if (!goMarket) {
      document.getElementById('gomarket-config-container').innerHTML = `
        <div style="text-align:center; padding:40px; background:var(--color-surface); border-radius:28px; border:1px solid var(--color-border); margin-top:20px;">
          <div style="width:64px; height:64px; border-radius:20px; background:var(--color-danger-light); color:var(--color-danger); display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">${icon('info', 32)}</div>
          <h2 style="font-weight:900; margin-bottom:8px;">No se encontró Go! Market</h2>
          <p style="color:var(--color-text-tertiary); font-weight:600; line-height:1.5;">El comercio oficial de la plataforma no está registrado en la base de datos.</p>
          <button onclick="location.hash='#/admin/comercios'" style="margin-top:24px; width:100%; height:54px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:800; cursor:pointer;">Ir a Gestión de Comercios</button>
        </div>
      `;
      return;
    }

    const data = { id: goMarket.id, ...goMarket.data() };
    renderConfigForm(data);
  } catch (err) {
    console.error('Error loading GoMarket config:', err);
    document.getElementById('gomarket-config-container').innerHTML = '<p style="text-align:center; padding:40px; color:var(--color-danger); font-weight:700;">Error al sincronizar datos</p>';
  }
}

function renderConfigForm(comercio) {
  const container = document.getElementById('gomarket-config-container');
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:24px; max-width:600px; margin:0 auto; padding-bottom:40px;">
      
      <div style="text-align:center; background:var(--color-surface); padding:24px; border-radius:28px; border:1px solid var(--color-border); box-shadow:0 4px 20px rgba(0,0,0,0.02);">
        <div style="width:100px; height:100px; border-radius:50%; overflow:hidden; border:2.5px solid var(--color-primary); margin:0 auto 16px; background:white; box-shadow:0 12px 30px rgba(var(--color-primary-rgb),0.2); padding:2px;">
          <img src="${comercio.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
        </div>
        <h2 style="font-family:var(--font-display); font-size:24px; font-weight:900; margin:0; color:var(--color-text);">${comercio.name}</h2>
        <div style="display:flex; justify-content:center; gap:10px; margin-top:20px;">
          <a href="#/mi-comercio/${comercio.id}/products" style="flex:1; height:54px; border-radius:18px; background:var(--color-primary); color:white; text-decoration:none; font-weight:800; font-size:14px; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.15);">
            ${icon('package', 20)} Gestionar Stock
          </a>
          <a href="#/comercio/${comercio.id}" target="_blank" style="padding:0 20px; height:54px; border-radius:18px; background:var(--color-bg-secondary); color:var(--color-text); text-decoration:none; font-weight:800; font-size:14px; display:flex; align-items:center; justify-content:center; border:1px solid var(--color-border);">
            ${icon('eye', 20)}
          </a>
        </div>
      </div>

      <div style="background:var(--color-surface); padding:24px; border-radius:28px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:20px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
          <div style="width:4px; height:16px; background:var(--color-primary); border-radius:2px;"></div>
          <h3 style="font-size:13px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.1em; margin:0;">Información General</h3>
        </div>
        
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; padding-left:4px;">Nombre Público</label>
          <input type="text" id="go-name" value="${comercio.name || ''}" style="width:100%; height:56px; border-radius:18px; border:1.5px solid var(--color-border); padding:0 18px; font-weight:700; font-size:16px; outline:none; transition:all 0.2s;" />
        </div>

        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; padding-left:4px;">Categoría / Rubro</label>
          <input type="text" id="go-category" value="${comercio.category || ''}" style="width:100%; height:56px; border-radius:18px; border:1.5px solid var(--color-border); padding:0 18px; font-weight:700; font-size:16px; outline:none;" />
        </div>

        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; padding-left:4px;">Dirección Física</label>
          <input type="text" id="go-address" value="${comercio.address || ''}" style="width:100%; height:56px; border-radius:18px; border:1.5px solid var(--color-border); padding:0 18px; font-weight:700; font-size:16px; outline:none;" />
        </div>
      </div>

      <div style="background:var(--color-surface); padding:24px; border-radius:28px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:20px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
          <div style="width:4px; height:16px; background:var(--color-primary); border-radius:2px;"></div>
          <h3 style="font-size:13px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.1em; margin:0;">Branding y Estética</h3>
        </div>
        
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; padding-left:4px;">Imagen de Logo (URL)</label>
          <input type="text" id="go-logo" value="${comercio.logo || ''}" style="width:100%; height:56px; border-radius:18px; border:1.5px solid var(--color-border); padding:0 18px; font-weight:700; font-size:14px; color:var(--color-primary); outline:none;" />
        </div>

        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; padding-left:4px;">Imagen de Banner (URL)</label>
          <input type="text" id="go-banner" value="${comercio.banner || ''}" style="width:100%; height:56px; border-radius:18px; border:1.5px solid var(--color-border); padding:0 18px; font-weight:700; font-size:14px; color:var(--color-primary); outline:none;" />
        </div>
      </div>

      <button id="save-gomarket-btn" style="width:100%; height:68px; border-radius:24px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:18px; cursor:pointer; box-shadow:0 12px 35px rgba(var(--color-primary-rgb),0.3); margin-top:10px; transition:all 0.2s;">
        Guardar Configuración
      </button>
    </div>
    <style>
      input:focus { border-color: var(--color-primary) !important; box-shadow: 0 0 0 4px rgba(var(--color-primary-rgb), 0.1); }
      #save-gomarket-btn:active { transform: scale(0.97); }
    </style>
  `;

  document.getElementById('save-gomarket-btn').onclick = async () => {
    const btn = document.getElementById('save-gomarket-btn');
    btn.disabled = true;
    btn.innerText = 'Sincronizando...';

    const updateData = {
      name: document.getElementById('go-name').value,
      category: document.getElementById('go-category').value,
      address: document.getElementById('go-address').value,
      logo: document.getElementById('go-logo').value,
      banner: document.getElementById('go-banner').value
    };

    try {
      await updateDoc(doc(db, 'comercios', comercio.id), updateData);
      showToast('GoMarket actualizado globalmente', 'success');
      setTimeout(() => renderAdminGoMarket(), 500);
    } catch (err) {
      console.error('Error saving GoMarket:', err);
      showToast('Error al guardar cambios', 'danger');
      btn.disabled = false;
      btn.innerText = 'Guardar Configuración';
    }
  };
}
