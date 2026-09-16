// Driver profile/vehicle edit modal for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens "Mi Perfil y Vehículo", instead of on every panel load.
import { getState, setState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { db } from '../../firebase.js';

export async function showDriverProfileEditModal(user) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');
  const { doc, updateDoc } = await import('firebase/firestore');

  const latestUser = getState().user || user;
  let photoDataUrl = latestUser.photoURL || '';
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 16px 20px calc(36px + env(safe-area-inset-bottom, 24px)) 20px;
    background: var(--driver-bg-panel);
    color: var(--driver-text-primary);
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
    font-family: var(--font-body, sans-serif);
  `;

  modalEl.innerHTML = `
    <!-- AVATAR SECTION -->
    <div style="display:flex; flex-direction:column; align-items:center; gap:10px; margin-top:2px;">
      <div style="position:relative; width:88px; height:88px;">
        <div id="driver-avatar-preview" style="
          width: 88px; height: 88px; border-radius: 50%;
          background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
          color: white; font-size: 34px; font-weight: 900;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; border: 3px solid ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)'};
          box-shadow: 0 10px 25px rgba(0,0,0,0.25);
        ">
          ${photoDataUrl ? `<img src="${photoDataUrl}" style="width:100%; height:100%; object-fit:cover;" />` : (latestUser.displayName || latestUser.name || 'R')[0].toUpperCase()}
        </div>
        <label for="driver-avatar-input" aria-label="Cambiar foto de perfil" style="
          position: absolute; bottom: 0px; right: 0px;
          width: 32px; height: 32px; border-radius: 50%;
          background: #e11d48; color: white;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; box-shadow: 0 4px 12px rgba(225,29,72,0.5);
          border: 2.5px solid var(--driver-bg-panel);
          transition: transform 0.2s ease;
        ">
          ${icon('camera', 15)}
        </label>
        <input type="file" id="driver-avatar-input" accept="image/*" style="display:none;" />
      </div>
      <span style="font-size:11.5px; color:var(--driver-text-secondary); font-weight:700; letter-spacing:0.2px;">Toca la cámara para cambiar foto</span>
    </div>

    <!-- FORM FIELDS -->
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div>
        <label style="font-size:11px; font-weight:900; color:var(--driver-text-secondary-b); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Nombre Completo</label>
        <input id="driver-name-input" type="text" value="${latestUser.displayName || latestUser.name || ''}" placeholder="Tu nombre" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid var(--driver-border-soft); color:var(--driver-text-primary); padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='var(--driver-border-soft)'" />
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:var(--driver-text-secondary-b); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Tipo de Vehículo</label>
        <select id="driver-vehicle-type-select" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid var(--driver-border-soft); color:var(--driver-text-primary); padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='var(--driver-border-soft)'">
          <option value="moto" ${(latestUser.vehicleType || latestUser.tripVehicleType || 'moto') === 'moto' ? 'selected' : ''}>Moto</option>
          <option value="auto" ${(latestUser.vehicleType || latestUser.tripVehicleType) === 'auto' ? 'selected' : ''}>Auto</option>
          <option value="bici" ${(latestUser.vehicleType || latestUser.tripVehicleType) === 'bici' ? 'selected' : ''}>Bicicleta</option>
        </select>
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:var(--driver-text-secondary-b); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Modelo del Vehículo</label>
        <input id="driver-vehicle-model-input" type="text" value="${latestUser.deliveryVehicleModel || latestUser.vehicleModel || ''}" placeholder="Ej: Honda Wave 110" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid var(--driver-border-soft); color:var(--driver-text-primary); padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='var(--driver-border-soft)'" />
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:var(--driver-text-secondary-b); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Patente del Vehículo</label>
        <input id="driver-vehicle-plate-input" type="text" value="${latestUser.deliveryVehiclePlate || latestUser.vehiclePlate || latestUser.plate || ''}" placeholder="Ej: A123BCD" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid var(--driver-border-soft); color:var(--driver-text-primary); padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; text-transform:uppercase; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='var(--driver-border-soft)'" />
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:var(--driver-text-secondary-b); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Alias / CBU para Cobros</label>
        <input id="driver-alias-input" type="text" value="${latestUser.transferAlias || latestUser.driverAlias || latestUser.alias || ''}" placeholder="Ej: juan.repartidor.mp" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid var(--driver-border-soft); color:var(--driver-text-primary); padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='var(--driver-border-soft)'" />
      </div>
    </div>

    <!-- LARGE BRAND RED SAVE BUTTON -->
    <button id="save-driver-profile-btn" style="
      width: 100%;
      height: 56px;
      border-radius: 18px;
      border: none;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
      color: white;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 10px 25px rgba(225, 29, 72, 0.45);
      margin-top: 6px;
      text-transform: uppercase;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    ">
      Guardar Cambios
    </button>
  `;

  showModal({
    title: `<span style="display:inline-flex; vertical-align:middle; margin-right:6px;">${icon('settings', 20)}</span>Mi Perfil y Vehículo`,
    content: modalEl,
    height: 'auto',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });

  const avatarInput = modalEl.querySelector('#driver-avatar-input');
  const avatarPreview = modalEl.querySelector('#driver-avatar-preview');
  if (avatarInput) {
    avatarInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          photoDataUrl = re.target.result;
          avatarPreview.innerHTML = `<img src="${photoDataUrl}" style="width:100%; height:100%; object-fit:cover;" />`;
        };
        reader.readAsDataURL(file);
      }
    };
  }

  const saveBtn = modalEl.querySelector('#save-driver-profile-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const newName = modalEl.querySelector('#driver-name-input').value.trim();
      const newVehicleType = modalEl.querySelector('#driver-vehicle-type-select').value;
      const newVehicleModel = modalEl.querySelector('#driver-vehicle-model-input').value.trim();
      const newVehiclePlate = modalEl.querySelector('#driver-vehicle-plate-input').value.trim().toUpperCase();
      const newAlias = modalEl.querySelector('#driver-alias-input').value.trim();

      if (!newName) {
        showToast('El nombre no puede estar vacío', 'warning');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = 'Guardando...';

      try {
        const updates = {
          displayName: newName,
          name: newName,
          vehicleType: newVehicleType,
          tripVehicleType: newVehicleType,
          deliveryVehicleModel: newVehicleModel,
          vehicleModel: newVehicleModel,
          deliveryVehiclePlate: newVehiclePlate,
          vehiclePlate: newVehiclePlate,
          plate: newVehiclePlate,
          driverAlias: newAlias,
          alias: newAlias,
          // transferAlias is the field everything else in the app actually reads
          // (order tracking, admin panel, the driver's own status pill) — without
          // this, the alias silently saved to an orphaned field nobody displays.
          transferAlias: newAlias
        };
        if (photoDataUrl && photoDataUrl !== latestUser.photoURL) {
          updates.photoURL = photoDataUrl;
        }

        await updateDoc(doc(db, 'users', latestUser.uid), updates);
        setState('user', { ...latestUser, ...updates });
        showToast('Perfil actualizado correctamente', 'success');
        closeModal();
      } catch (err) {
        console.error('Error saving driver profile:', err);
        showToast('Error al guardar perfil', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Guardar Cambios';
      }
    };
  }
}

