// Standorte als Karte: Einbettung von Google Maps über die Adresse (ohne API-Schlüssel) und Link zur Route.
export type Office = { label: string; address: string; phone: string };

export const officeId = (o: Office) =>
  o.label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/)[0];

export const mapEmbed = (o: Office) => `https://maps.google.com/maps?q=${encodeURIComponent(o.address)}&z=15&output=embed`;
export const mapRoute = (o: Office) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.address)}`;
