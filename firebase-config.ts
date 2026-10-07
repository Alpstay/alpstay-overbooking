/**
 * Configurazione del progetto Firebase.
 *
 * I sei valori si prendono dalla console Firebase:
 *   ⚙ Impostazioni → Generali → Le tue app → app Web → blocco firebaseConfig.
 *
 * Non sono segreti: nelle applicazioni web Firebase li espone per costruzione. La sicurezza la
 * fanno due cose: il login con email e password, e le regole in `firestore.rules`, che senza
 * utente autenticato non lasciano leggere né scrivere niente.
 *
 * Con i campi vuoti la piattaforma non chiede nessun accesso e salva nel browser.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyDiNn7xYdmgMRBxkoPS1CtENEB1sAP-rF4",
  authDomain: "alpstay-overbooking.firebaseapp.com",
  projectId: "alpstay-overbooking",
  storageBucket: "alpstay-overbooking.firebasestorage.app",
  messagingSenderId: "503006506020",
  appId: "1:503006506020:web:29fdb30a8c40da5a057cb1",
};

/** Versione dell'SDK caricata dalla CDN di Google. Si può alzare senza toccare altro. */
export const FIREBASE_SDK = "10.14.1";

export function firebaseConfigurato(c: FirebaseConfig = FIREBASE_CONFIG): boolean {
  return Boolean(c.apiKey && c.projectId && c.authDomain && c.appId);
}
