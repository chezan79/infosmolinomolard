
// Configurazione Firebase
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Sostituisci con le tue credenziali Firebase
const firebaseConfig = {
  apiKey: "la-tua-api-key",
  authDomain: "il-tuo-progetto.firebaseapp.com",
  projectId: "il-tuo-project-id",
  storageBucket: "il-tuo-progetto.appspot.com",
  messagingSenderId: "123456789",
  appId: "la-tua-app-id"
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);

// Inizializza Firestore
export const db = getFirestore(app);

// Inizializza Auth
export const auth = getAuth(app);

export default app;
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
  import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";

  // 🔧 CONFIG FIREBASE
  const firebaseConfig = {
    apiKey: "TUO_API_KEY",
    authDomain: "tuo-progetto.firebaseapp.com",
    projectId: "tuo-progetto",
    storageBucket: "infosmolinomoard.appspot.com",
    appId: "1:XXXX:web:YYYY"
  };
  const app = initializeApp(firebaseConfig);
  const storage = getStorage(app);

  // 📁 Percorsi fissi ordinati
  const folder = "public/pdfs";
  const FILES = {
    weekCurrent:  "planning-semaine.pdf",
    weekNext:     "planning-semaine-prochaine.pdf",
    monthCurrent: "planning-mois.pdf",
    monthNext:    "planning-mois-prochain.pdf",
  };

  // carica link disponibili
  async function setLinks() {
    for (const [key, name] of Object.entries(FILES)) {
      const a = document.getElementById(`link-${key}`);
      try {
        const url = await getDownloadURL(ref(storage, `${folder}/${name}`));
        a.href = url;
        a.textContent = "Apri";
        a.style.opacity = 1;
      } catch {
        a.removeAttribute("href");
        a.textContent = "Non disponibile";
        a.style.opacity = 0.6;
      }
    }
  }

  // renderizza una pagina nel canvas con PDF.js
  async function viewPath(storagePath) {
    const url = await getDownloadURL(ref(storage, storagePath));
    const loadingTask = pdfjsLib.getDocument({ url });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.getElementById("pdf-canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  // gestisci i 4 slot
  function mountSlots() {
    const slots = document.querySelectorAll(".slot");
    slots.forEach(slot => {
      const key = slot.dataset.key;
      const fixedName = FILES[key]; // nome file desiderato in Storage
      const form = slot.querySelector(".upload-form");
      const msg = slot.querySelector(".msg");
      const viewBtn = slot.querySelector(".view-btn");

      // Upload con password → invia a Cloud Function
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        msg.textContent = "⏳ Caricamento...";
        const fileInput = form.querySelector('input[type="file"]');
        const passInput = form.querySelector('input[type="password"]');
        const file = fileInput.files[0];
        if (!file || file.type !== "application/pdf") { msg.textContent = "Seleziona un PDF"; return; }

        // rinomina il file al volo → sovrascrive sempre il nome fisso
        const renamed = new File([file], fixedName, { type: "application/pdf" });

        const data = new FormData();
        data.append("file", renamed);
        data.append("password", passInput.value);

        try {
          const res = await fetch("/api/uploadPdf", { method: "POST", body: data });
          const out = await res.json();
          if (!out.success) throw new Error(out.error || "Errore upload");
          msg.textContent = "✅ Caricato correttamente";
          await setLinks();                       // aggiorna link
          await viewPath(`${folder}/${fixedName}`); // mostra subito
          fileInput.value = ""; passInput.value = "";
        } catch (err) {
          msg.textContent = "❌ " + err.message;
        }
      });

      // Visualizza nel canvas quel documento
      viewBtn.addEventListener("click", async () => {
        try { await viewPath(`${folder}/${fixedName}`); }
        catch { alert("File non disponibile"); }
      });
    });
  }

  (async () => { await setLinks(); mountSlots(); })();
</script>
