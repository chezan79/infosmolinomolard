import * as functions from "firebase-functions";
import { Storage } from "@google-cloud/storage";
import Busboy from "busboy";

const storage = new Storage();
const BUCKET = process.env.STORAGE_BUCKET;       // es: infosmolinomoard.appspot.com
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;

export const uploadPdf = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", "*"); // in prod metti il tuo dominio
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const busboy = Busboy({ headers: req.headers });
  let password = "";
  let fileMeta = null;
  let fileBuffer = Buffer.alloc(0);

  busboy.on("field", (name, val) => { if (name === "password") password = val || ""; });
  busboy.on("file", (_n, file, info) => {
    const { filename, mimeType } = info;
    fileMeta = { filename, mimeType };
    file.on("data", d => { fileBuffer = Buffer.concat([fileBuffer, d]); });
  });

  busboy.on("finish", async () => {
    try {
      if (!password || password !== UPLOAD_PASSWORD)
        return res.status(401).json({ success: false, error: "Password errata" });
      if (!fileMeta) return res.status(400).json({ success: false, error: "Nessun file" });
      if (fileMeta.mimeType !== "application/pdf")
        return res.status(400).json({ success: false, error: "Solo PDF consentiti" });

      const safeName = fileMeta.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const objectPath = `public/pdfs/${safeName}`;

      const file = storage.bucket(BUCKET).file(objectPath);
      await file.save(fileBuffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: { cacheControl: "public, max-age=3600, s-maxage=86400" },
      });

      return res.json({ success: true, path: objectPath });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: "Errore server" });
    }
  });

  req.pipe(busboy);
});
