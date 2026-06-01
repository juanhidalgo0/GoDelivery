// GoDelivery — Desktop Global Footer Component
import { icon } from '../utils/icons.js';

export function getFooterHTML() {
  return `
    <footer class="desktop-global-footer">
      <div class="footer-container">
        <div class="footer-columns">
          <div class="footer-column">
            <h4>Sobre GoDelivery</h4>
            <ul>
              <li><a href="#/profile">Mi Perfil</a></li>
              <li><a href="#/profile/orders">Términos y Condiciones</a></li>
              <li><a href="#/profile">Política de Privacidad</a></li>
              <li><a href="#/profile" style="text-decoration: underline;">Libro de quejas online</a></li>
            </ul>
          </div>
          <div class="footer-column">
            <h4>Top comidas</h4>
            <ul>
              <li><a href="#/category/Comida">Hamburguesas</a></li>
              <li><a href="#/category/Comida">Pizzas y Empanadas</a></li>
              <li><a href="#/category/Comida">Helados y Postres</a></li>
              <li><a href="#/category/GoMarket">Bebidas y Tragos</a></li>
            </ul>
          </div>
          <div class="footer-column">
            <h4>Registra tu negocio</h4>
            <ul>
              <li><a href="#/admin">Centro de Socios</a></li>
              <li><a href="#/mi-comercio">Registrar mi Comercio</a></li>
              <li><a href="#/delivery">Unirse como Repartidor</a></li>
              <li><a href="#/gofavores">Soporte y Ayuda</a></li>
            </ul>
          </div>
          <div class="footer-column">
            <h4>GoDelivery para tus colaboradores</h4>
            <ul>
              <li><a href="#/gofavores">Beneficios Corporativos</a></li>
              <li><a href="#/gofavores">Cupones Especiales</a></li>
              <li><a href="#/notifications">Centro de Ayuda</a></li>
            </ul>
          </div>
        </div>
        
        <div class="footer-divider"></div>
        
        <div class="footer-legal-section">
          <div class="footer-legal-links">
            <a href="#/profile">¿Te arrepentiste de una compra? Botón de arrepentimiento</a>
            <a href="#/profile">Defensa de las y los Consumidores. Para reclamos ingresá acá</a>
            <a href="#/profile">Ley N° 24.240 de Defensa del Consumidor. Ver contratos de adhesión</a>
          </div>
          
          <div class="footer-bottom-row">
            <div class="footer-cuit-info">
              GODELIVERY E-COMMERCE S.A. CUIT: 30-71198576-6 | Av. del Libertador 7208, piso 20, Ciudad Autónoma de Buenos Aires | contacto@godelivery.com<br/>
              Para notificaciones legales y oficios: notificacionesargentina@godelivery.com<br/>
              GoDelivery © 2010-2026
            </div>
            
            <div class="footer-data-fiscal">
              <svg width="46" height="58" viewBox="0 0 46 58" fill="none" style="border: 2px solid white; border-radius: 4px; padding: 2px; background: white;">
                <rect width="46" height="58" fill="white"/>
                <rect x="4" y="4" width="38" height="38" fill="black"/>
                <rect x="8" y="8" width="10" height="10" fill="white"/>
                <rect x="28" y="8" width="10" height="10" fill="white"/>
                <rect x="8" y="28" width="10" height="10" fill="white"/>
                <!-- QR details -->
                <rect x="12" y="12" width="2" height="2" fill="black"/>
                <rect x="32" y="12" width="2" height="2" fill="black"/>
                <rect x="12" y="32" width="2" height="2" fill="black"/>
                <rect x="22" y="14" width="4" height="4" fill="white"/>
                <rect x="18" y="22" width="8" height="8" fill="white"/>
                <!-- Bottom text -->
                <text x="5" y="49" fill="#005A9C" font-family="Arial, sans-serif" font-size="5" font-weight="bold">DATA</text>
                <text x="5" y="55" fill="#E21B3C" font-family="Arial, sans-serif" font-size="5" font-weight="bold">FISCAL</text>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </footer>
  `;
}
