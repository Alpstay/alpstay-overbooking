// Schermata di accesso, mostrata prima della piattaforma quando Firebase è configurato.
import { esc } from "./util";

export interface LoginState {
  email: string;
  errore: string;
  avviso: string;
  attesa: boolean;
}

export function loginVuoto(): LoginState {
  return { email: "", errore: "", avviso: "", attesa: false };
}

export function viewLogin(l: LoginState): string {
  return `<div class="login">
    <form class="login-box" id="login-form" autocomplete="on">
      <div class="login-head">
        <span class="mark" aria-hidden="true"></span>
        <div><h1>Overbooking</h1><p>AlpStay Hotels</p></div>
      </div>
      <p class="muted">Accesso riservato allo staff. Usa l'indirizzo di posta aziendale e la password che ti è stata consegnata.</p>
      ${l.errore ? `<p class="login-err" role="alert">${esc(l.errore)}</p>` : ""}
      ${l.avviso ? `<p class="login-ok" role="status">${esc(l.avviso)}</p>` : ""}
      <label class="field">Email
        <input type="email" id="login-email" name="email" autocomplete="username" required value="${esc(l.email)}" placeholder="nome@alpstay.eu"></label>
      <label class="field">Password
        <input type="password" id="login-pass" name="password" autocomplete="current-password" required></label>
      <button class="btn gold" type="submit" ${l.attesa ? "disabled" : ""}>${l.attesa ? "Accesso in corso…" : "Entra"}</button>
      <button class="linkbtn" type="button" data-act="login-reset">Ho dimenticato la password</button>
      <p class="muted"><small>Se non hai un accesso, chiedilo a chi amministra la piattaforma: gli account si creano uno per persona, così si sa sempre chi ha fatto cosa e basta toglierne uno quando un collaboratore se ne va.</small></p>
    </form>
  </div>`;
}

/** Schermata di errore quando Firebase è configurato ma non si riesce a raggiungerlo. */
export function viewLoginKo(motivo: string): string {
  return `<div class="login">
    <div class="login-box">
      <div class="login-head">
        <span class="mark" aria-hidden="true"></span>
        <div><h1>Overbooking</h1><p>AlpStay Hotels</p></div>
      </div>
      <p class="login-err">${esc(motivo)}</p>
      <p class="muted">La piattaforma può lavorare lo stesso, ma i dati restano su questo computer e non li vedono i colleghi. Se stai solo provando le funzioni va benissimo; se stai lavorando davvero, aspetta che l'accesso torni a funzionare.</p>
      <button class="btn ghost" data-act="login-locale">Continua senza accesso, solo su questo computer</button>
      <button class="linkbtn" type="button" data-act="login-riprova">Riprova</button>
    </div>
  </div>`;
}
