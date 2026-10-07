/**
 * Configurazione del progetto Firebase.
 *
 * I sei valori si prendono dalla console Firebase:
 *   ⚙ Impostazioni progetto → Le tue app → app Web → blocco firebaseConfig.
 *
 * Non sono segreti: nelle applicazioni web Firebase li espone per costruzione, e in questo
 * repository pubblico stanno nel codice come ovunque altrove. La sicurezza la fanno due cose:
 * il login con email e password, e le regole in `firestore.rules`, che senza utente autenticato
 * non lasciano leggere né scrivere niente.
 *
 * Con i campi vuoti la piattaforma non chiede nessun accesso e salva nel browser, come prima.
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
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

/** Versione dell'SDK caricata dalla CDN di Google. Si può alzare senza toccare altro. */
export const FIREBASE_SDK = "10.14.1";

export function firebaseConfigurato(c: FirebaseConfig = FIREBASE_CONFIG): boolean {
  return Boolean(c.apiKey && c.projectId && c.authDomain && c.appId);
}
