/**
 * Accesso e archivio condiviso su Firebase.
 *
 * L'SDK viene caricato a runtime dalla CDN di Google nella versione "compat", che espone
 * `firebase.firestore().doc(path)` con get/set/delete/onSnapshot: la stessa forma del database
 * dell'artifact, così `storage.ts` non deve sapere su cosa sta scrivendo.
 *
 * Se la rete non raggiunge la CDN, niente si rompe: `initFirebase` restituisce un errore
 * leggibile e la piattaforma continua in locale sul browser.
 */
import { FIREBASE_CONFIG, FIREBASE_SDK, firebaseConfigurato } from "./firebase-config";

interface CompatDocSnap { exists: boolean; data(): Record<string, unknown> | undefined; }
interface CompatDocRef {
  get(): Promise<CompatDocSnap>;
  set(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: CompatDocSnap) => void, err?: (e: unknown) => void): () => void;
}
interface CompatUser { uid: string; email: string | null }
interface CompatAuth {
  currentUser: CompatUser | null;
  signInWithEmailAndPassword(email: string, pass: string): Promise<unknown>;
  signOut(): Promise<void>;
  sendPasswordResetEmail(email: string): Promise<void>;
  onAuthStateChanged(cb: (u: CompatUser | null) => void): () => void;
}
interface CompatFirestore { doc(path: string): CompatDocRef }
interface CompatApp {
  initializeApp(c: unknown): void;
  apps: unknown[];
  auth(): CompatAuth;
  firestore(): CompatFirestore;
}

declare global {
  interface Window { firebase?: CompatApp }
}

const CDN = "https://www.gstatic.com/firebasejs";

function caricaScript(src: string): Promise<void> {
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;   // l'ordine conta: app prima di auth e firestore
    s.onload = () => ok();
    s.onerror = () => ko(new Error(`Non riesco a caricare ${src}`));
    document.head.appendChild(s);
  });
}

export interface FirebaseHandle {
  auth: CompatAuth;
  db: { doc(path: string): CompatDocRef };
}

let handle: FirebaseHandle | null = null;

/** Carica l'SDK e inizializza il progetto. Una volta sola: le chiamate dopo la prima non rifanno nulla. */
export async function initFirebase(): Promise<FirebaseHandle> {
  if (handle) return handle;
  if (!firebaseConfigurato()) throw new Error("Firebase non è configurato in firebase-config.ts.");

  // Se l'SDK è già presente — perché qualcuno lo serve da sé, o lo ha caricato una pagina
  // ospitante — non si ricarica dalla CDN.
  if (!window.firebase) {
    for (const m of ["app", "auth", "firestore"]) {
      await caricaScript(`${CDN}/${FIREBASE_SDK}/firebase-${m}-compat.js`);
    }
  }
  const fb = window.firebase;
  if (!fb) throw new Error("L'SDK di Firebase si è caricato ma non si è registrato: svuota la cache e riprova.");
  if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);

  handle = { auth: fb.auth(), db: fb.firestore() };
  return handle;
}

/** Messaggi di errore dell'accesso, in italiano e senza gergo. */
export function messaggioAuth(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? "");
  switch (code) {
    case "auth/invalid-email": return "L'indirizzo email non è scritto bene.";
    case "auth/user-disabled": return "Questo accesso è stato disattivato. Chiedi a chi amministra la piattaforma.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Email o password non corrispondono.";
    case "auth/too-many-requests": return "Troppi tentativi. Aspetta qualche minuto, oppure reimposta la password.";
    case "auth/network-request-failed": return "Nessuna connessione. Controlla la rete e riprova.";
    case "auth/missing-password": return "Manca la password.";
    default: {
      const m = (e as { message?: string })?.message;
      return m ? `Accesso non riuscito: ${m}` : "Accesso non riuscito.";
    }
  }
}

export async function accedi(email: string, password: string): Promise<void> {
  const h = await initFirebase();
  await h.auth.signInWithEmailAndPassword(email.trim(), password);
}

export async function esci(): Promise<void> {
  if (handle) await handle.auth.signOut();
}

export async function reimpostaPassword(email: string): Promise<void> {
  const h = await initFirebase();
  await h.auth.sendPasswordResetEmail(email.trim());
}

export function utenteCorrente(): CompatUser | null {
  return handle?.auth.currentUser ?? null;
}

/** Attende la prima risposta di Firebase su chi è collegato. */
export function attendiAuth(): Promise<CompatUser | null> {
  return new Promise((ok) => {
    if (!handle) return ok(null);
    const stop = handle.auth.onAuthStateChanged((u) => { stop(); ok(u); });
  });
}

export function alCambioAuth(cb: (u: CompatUser | null) => void): void {
  handle?.auth.onAuthStateChanged(cb);
}
