// Telefonnummern beim Eintippen ordnen: nur Ziffern und ein führendes +, sinnvoll gruppiert.
// 0151 2345 6789 · 030 1234 5678 · +49 151 2345 6789

export function digitsOf(v: string) {
  return v.replace(/\D/g, "");
}

function groups(rest: string) {
  return rest.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function formatPhone(raw: string): string {
  let v = raw.replace(/[^\d+]/g, "");
  v = v.replace(/(?!^)\+/g, ""); // + nur am Anfang
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (v.startsWith("+")) {
    const d = v.slice(1);
    const cc = d.startsWith("49") || d.startsWith("43") || d.startsWith("41") || d.startsWith("48") ? d.slice(0, 2) : d.slice(0, d.startsWith("7") || d.startsWith("1") ? 1 : 3);
    const rest = d.slice(cc.length);
    const area = rest.slice(0, rest.startsWith("1") ? 3 : rest.startsWith("30") || rest.startsWith("40") || rest.startsWith("89") ? 2 : 3);
    return ["+" + cc, area, groups(rest.slice(area.length))].filter(Boolean).join(" ");
  }
  if (v.startsWith("0")) {
    // Mobil 015x/016x/017x: 4-stellige Vorwahl; Berlin 030, Hamburg 040, München 089: 3-stellig; sonst 4-stellig
    const len = /^0(30|40|89)/.test(v) ? 3 : 4;
    const pre = v.slice(0, len);
    const rest = v.slice(len);
    return rest ? `${pre} ${groups(rest)}` : pre;
  }
  return groups(v);
}

/** Plausibel: 7–15 Ziffern */
export function phoneOk(v: string) {
  const n = digitsOf(v).length;
  return n >= 7 && n <= 15;
}
