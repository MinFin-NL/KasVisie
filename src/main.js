/* Vite-entry van de frontend. Volgorde is functioneel, niet cosmetisch:
   ES-modules worden in importvolgorde uitgevoerd, dus het design system
   registreert al zijn custom elements vóór app.js de eerste markup opbouwt.
   Dat is dezelfde reden waarom de losse scripts vroeger `defer` nodig hadden:
   een nldd-*-element dat op zijn inhoud let (nldd-menu-bar zet zichzelf op
   `empty` en verdwijnt) trekt de verkeerde conclusie als het te vroeg
   opwaardeert. */

// Registreert elk <nldd-*>-custom element. Side-effectful (customElements.define),
// dus de import moet blijven staan om de tags te laten opwaarderen — en om
// dezelfde reden valt er niets aan weg te tree-shaken. Wordt de bundel te
// groot, dan versmal je naar losse subpath-imports ('@nldd/design-system/button', …).
import "@nldd/design-system";
import "@nldd/design-system/styles";

import "./style.css";
import "./app.js";
