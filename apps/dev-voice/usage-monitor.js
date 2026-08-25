class YiboLiveUsage extends HTMLElement {
  async connectedCallback() {
    this.attachShadow({ mode: "open" });
    this.usage = { inputTokens: 0, outputTokens: 0, inputAudioMs: 0, outputAudioMs: 0, toolCalls: 0 };
    this.billing = undefined;
    this.changed = new Set();
    this.render();
    await Promise.all([this.refreshUsage(), this.refreshBilling()]);
    this.usageTimer = setInterval(() => this.refreshUsage(), 1500);
    this.billingTimer = setInterval(() => this.refreshBilling(), 60_000);
  }

  disconnectedCallback() {
    clearInterval(this.usageTimer);
    clearInterval(this.billingTimer);
  }

  async refreshUsage() {
    if (this.loadingUsage || document.hidden) return;
    this.loadingUsage = true;
    try {
      const next = await fetch("/api/usage").then(check);
      this.changed = new Set(Object.keys(next).filter((key) => this.usage?.[key] !== next[key]));
      this.usage = next;
      this.lastUpdated = new Date();
      this.render();
    } catch (error) {
      this.error = error.message;
      this.render();
    } finally {
      this.loadingUsage = false;
    }
  }

  async refreshBilling() {
    if (this.loadingBilling || document.hidden) return;
    this.loadingBilling = true;
    try {
      this.billing = await fetch("/api/billing").then(check);
      this.render();
    } catch (error) {
      this.billing = { configured: true, error: error.message };
      this.render();
    } finally {
      this.loadingBilling = false;
    }
  }

  render() {
    const u = this.usage;
    this.shadowRoot.innerHTML = `<style>${styles}</style><section aria-live="polite">
      <header><div><small>EN VIVO · SESIÓN Y ACUMULADO</small><strong>Lo que consume YIBO</strong></div><span><i></i>${this.error ? "Sin conexión" : "Actualizando"}</span></header>
      ${billingView(this.billing)}
      <div class="metrics">
        ${metric("inputTokens", "↙", "Tokens recibidos", format(u.inputTokens), "Texto y contexto que recibe el modelo", this.changed)}
        ${metric("outputTokens", "↗", "Tokens generados", format(u.outputTokens), "Texto que genera el modelo", this.changed)}
        ${metric("inputAudioMs", "◖", "Audio caller", `${minutes(u.inputAudioMs)} min`, "Audio de entrada procesado", this.changed)}
        ${metric("outputAudioMs", "◗", "Audio YIBO", `${minutes(u.outputAudioMs)} min`, "Audio de salida generado", this.changed)}
        ${metric("toolCalls", "◇", "Acciones", format(u.toolCalls), "Herramientas ejecutadas", this.changed)}
      </div>
      <footer><span>${this.lastUpdated ? `Actualizado ${this.lastUpdated.toLocaleTimeString("es-MX")}` : "Conectando…"}</span><button type="button">↻ Sincronizar ahora</button></footer>
    </section>`;
    this.shadowRoot.querySelector("button")?.addEventListener("click", () => Promise.all([this.refreshUsage(), this.refreshBilling()]));
  }
}

const metric = (key, icon, label, value, help, changed) => `<article class="${changed.has(key) ? "changed" : ""}" title="${help}"><i>${icon}</i><span><small>${label}</small><strong>${value}</strong></span></article>`;
const billingView = (billing) => {
  if (!billing) return `<div class="billing loading">Consultando gasto oficial…</div>`;
  if (!billing.configured) return `<div class="billing setup"><b>Gasto no sincronizado</b><span>Añade <code>OPENAI_ADMIN_KEY</code> para mostrar costos oficiales.</span></div>`;
  if (billing.error) return `<div class="billing failed"><b>No se pudo sincronizar el gasto</b><span>${escape(billing.error)}</span></div>`;
  const value = billing.summary;
  return `<div class="billing synced"><span><small>GASTO OFICIAL · MES ACTUAL</small><strong>${money(value.currentMonth, value.currency)}</strong></span><span>Últimos 7 días <b>${money(value.lastSevenDays, value.currency)}</b></span></div>`;
};
const check = async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`); return body; };
const format = (value) => new Intl.NumberFormat("es-MX").format(value ?? 0);
const money = (value, currency) => new Intl.NumberFormat("es-MX", { style: "currency", currency: (currency ?? "usd").toUpperCase() }).format(value ?? 0);
const minutes = (value) => ((value ?? 0) / 60_000).toFixed(2);
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const styles = `:host{display:block;color:#2b2522;font:12px "Trebuchet MS",Avenir,system-ui}section{width:92%;margin:0 auto;background:transparent;border:0;border-top:1px solid #c9bdb0;border-radius:0;box-shadow:none;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:11px 3px 8px;background:transparent;color:#2b2522}header>div{display:flex;align-items:baseline;gap:10px}header small{color:#7a3348;font-size:8px;letter-spacing:.14em}header strong{font:500 17px Georgia,"Times New Roman",serif}header>span{font-size:9px;color:#716762}header>span i{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:#9ead9d;box-shadow:0 0 0 0 #9ead9d88;animation:live 1.8s infinite}.billing{display:flex;align-items:center;gap:12px;padding:7px 3px;border-block:1px solid #ded5c8}.billing span{color:#716762;font-size:10px}.billing code{color:#7a3348}.billing.loading{color:#716762}.billing.setup{background:transparent}.billing.failed{background:#7a334811}.billing.synced{justify-content:space-between;background:#9ead9d18}.billing.synced>span{display:flex;align-items:baseline;gap:8px}.billing.synced small{font-size:8px;letter-spacing:.1em}.billing.synced strong{font-size:16px;color:#7a3348}.metrics{display:grid;grid-template-columns:repeat(5,1fr);background:transparent;border-bottom:1px solid #ded5c8}.metrics article{display:flex;align-items:center;gap:9px;padding:13px 15px;background:transparent;border-right:1px solid #ded5c8;transition:.25s}.metrics article:last-child{border-right:0}.metrics article:nth-child(2),.metrics article:nth-child(4){background:transparent;color:#2b2522}.metrics article>i{font-style:normal;font-size:15px;color:#7a3348}.metrics article small{display:block;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#716762}.metrics article strong{font:500 18px Georgia,"Times New Roman",serif}.metrics article.changed{animation:pop .55s ease;background:#9ead9d1c}footer{display:flex;justify-content:space-between;align-items:center;padding:7px 3px 12px;color:#81766e;font-size:9px}footer button{border:0;background:transparent;color:#7a3348;font:700 9px inherit;cursor:pointer}@keyframes live{70%{box-shadow:0 0 0 7px #9ead9d00}}@keyframes pop{45%{transform:translateY(-2px)}}@media(max-width:850px){section{width:90%}.metrics{grid-template-columns:repeat(2,1fr)}.metrics article{border-bottom:1px solid #ded5c8}.metrics article:last-child{grid-column:1/-1}.billing.synced{align-items:flex-start}.billing.synced>span{display:grid}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

customElements.define("yibo-live-usage", YiboLiveUsage);
