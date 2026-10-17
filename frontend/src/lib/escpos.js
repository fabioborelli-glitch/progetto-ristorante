const ESC = 0x1b;
const GS = 0x1d;
const WIDTH = 32;

function ascii(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/€/g, "EUR")
    .replace(/[^\x20-\x7e]/g, "?");
}

function money(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

class Builder {
  constructor() {
    this.parts = [];
    this.push([ESC, 0x40]);
  }
  push(arr) {
    this.parts.push(Uint8Array.from(arr));
    return this;
  }
  text(s) {
    const enc = new TextEncoder();
    this.parts.push(enc.encode(ascii(s) + "\n"));
    return this;
  }
  align(a) {
    return this.push([ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0]);
  }
  bold(on) {
    return this.push([ESC, 0x45, on ? 1 : 0]);
  }
  size(big) {
    return this.push([GS, 0x21, big ? 0x11 : 0x00]);
  }
  row(left, right) {
    const l = ascii(left);
    const r = ascii(right);
    const space = Math.max(1, WIDTH - l.length - r.length);
    return this.text(l.slice(0, WIDTH - r.length - 1) + " ".repeat(space) + r);
  }
  rule() {
    return this.text("-".repeat(WIDTH));
  }
  feed(n = 3) {
    return this.push([ESC, 0x64, n]);
  }
  cut() {
    return this.push([GS, 0x56, 0x01]);
  }
  bytes() {
    const len = this.parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export function buildReceipt(bill, tenant) {
  const b = new Builder();
  b.align("center").bold(true).size(true).text(tenant?.name || "").size(false).bold(false);
  [tenant?.address, tenant?.city, tenant?.phone].filter(Boolean).forEach((x) => b.text(x));
  b.text("").bold(true).text("DOCUMENTO NON FISCALE").bold(false).text("Scontrino di cortesia").rule();
  b.align("left");
  const when = new Date(bill.closed_at || Date.now());
  b.row(`Tavolo ${bill.table_name}`, when.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
  if (bill.number) b.row(`Conto n. ${bill.number}`, `Coperti ${bill.covers || "-"}`);
  b.rule();
  for (const l of bill.lines) {
    const name = l.name + (l.variant ? ` (${l.variant})` : "");
    b.row(`${l.qty} x ${name}`, money(l.qty * l.price));
  }
  b.rule();
  b.row("Subtotale", `${money(bill.subtotal)} EUR`);
  if (bill.discount_amount > 0) b.row(bill.discount_type === "percent" ? `Sconto ${bill.discount_value}%` : "Sconto", `-${money(bill.discount_amount)} EUR`);
  b.bold(true).size(true).row("TOTALE", `${money(bill.total)}`).size(false).bold(false);
  for (const pm of bill.payments || []) b.row(`Pagato ${pm.method}`, `${money(pm.amount)} EUR`);
  b.text("").align("center").bold(true).text("Grazie e arrivederci!").bold(false).text("Documento non valido ai fini fiscali");
  b.feed(4).cut();
  return b.bytes();
}

export function buildTestPrint(tenant) {
  const b = new Builder();
  b.align("center").bold(true).size(true).text("RistoOS").size(false).bold(false).text(tenant?.name || "").text("Stampa di prova OK").feed(3).cut();
  return b.bytes();
}

export function receiptHtml(bill, tenant) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const when = new Date(bill.closed_at || Date.now()).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows = bill.lines.map((l) => `<tr><td>${l.qty} × ${esc(l.name)}${l.variant ? ` <small>(${esc(l.variant)})</small>` : ""}</td><td class="r">${money(l.qty * l.price)}</td></tr>`).join("");
  const pays = (bill.payments || []).map((p) => `<tr><td>Pagato ${esc(p.method)}</td><td class="r">${money(p.amount)} €</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Scontrino</title>
<style>@page{size:80mm auto;margin:4mm}body{font-family:Menlo,Consolas,monospace;font-size:12px;width:72mm;margin:0;color:#000}
h1{font-size:18px;text-align:center;margin:0 0 4px}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
hr{border:0;border-top:1px dashed #000;margin:6px 0}.tot td{font-size:16px;font-weight:700;padding-top:4px}small{color:#444}</style></head><body>
<h1>${esc(tenant?.name)}</h1>
<div class="c">${[tenant?.address, tenant?.city, tenant?.phone].filter(Boolean).map(esc).join("<br>")}</div>
<hr><div class="c"><b>DOCUMENTO NON FISCALE</b><br>Scontrino di cortesia</div><hr>
<table><tr><td>Tavolo ${esc(bill.table_name)}</td><td class="r">${when}</td></tr>${bill.number ? `<tr><td>Conto n. ${esc(bill.number)}</td><td class="r">Coperti ${bill.covers || "-"}</td></tr>` : ""}</table>
<hr><table>${rows}</table><hr>
<table><tr><td>Subtotale</td><td class="r">${money(bill.subtotal)} €</td></tr>
${bill.discount_amount > 0 ? `<tr><td>${bill.discount_type === "percent" ? `Sconto ${bill.discount_value}%` : "Sconto"}</td><td class="r">−${money(bill.discount_amount)} €</td></tr>` : ""}
<tr class="tot"><td>TOTALE</td><td class="r">${money(bill.total)} €</td></tr>${pays}</table>
<hr><div class="c"><b>Grazie e arrivederci!</b><br><small>Documento non valido ai fini fiscali</small></div>
<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script></body></html>`;
}
