import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import Imap from "imap";
import { simpleParser } from "mailparser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar whitelist
const whitelistPath = path.join(__dirname, "whitelist.txt");
let whitelist = [];

try {
  const content = fs.readFileSync(whitelistPath, "utf-8");
  whitelist = content
    .split("\n")
    .map(n => n.trim())
    .filter(n => n !== "");
  console.log("✅ Números autorizados cargados:", whitelist);
} catch (err) {
  console.error("❌ No se pudo leer el archivo whitelist.txt:", err.message);
}

function puedeUsarBot(jid) {
  const numero = jid.split("@")[0].replace(/\D/g, "");
  const autorizado = whitelist.some(n => n.replace(/\D/g, "") === numero);
  console.log(`puedeUsarBot: Número ${numero} autorizado: ${autorizado}`);
  return autorizado;
}

const buscarCodigo = () => {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: "",
      password: "", // Usa contraseña de aplicación
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    const abrirInbox = (cb) => {
      imap.openBox("INBOX", false, cb);
    };

    imap.once("ready", () => {
      abrirInbox((err, box) => {
        if (err) return reject(err);

        const desde = Math.max(box.messages.total - 20, 1);
        const fetcher = imap.seq.fetch(`${desde}:*`, { bodies: "" });

        let ultimoCodigo = null;
        let mensajesProcesados = 0;
        const totalMensajes = box.messages.total - desde + 1;

        fetcher.on("message", (msg) => {
          let buffer = "";

          msg.on("body", (stream) => {
            stream.on("data", (chunk) => {
              buffer += chunk.toString("utf8");
            });
          });

          msg.once("end", async () => {
            try {
              const parsed = await simpleParser(buffer);
              const textoBuscar = (parsed.subject || "" + " " + parsed.text || "").toLowerCase();

              if (/c[oó]digo|verificaci[oó]n/.test(textoBuscar)) {
                let match = parsed.subject?.match(/\b\d{6}\b/) || parsed.text?.match(/\b\d{6}\b/);
                if (!match && parsed.html) {
                  const textoLimpio = parsed.html.replace(/<[^>]+>/g, " ");
                  match = textoLimpio.match(/\b\d{6}\b/);
                }
                if (match) ultimoCodigo = match[0];
              }
            } catch (err) {
              console.error("Error al procesar email:", err);
            } finally {
              mensajesProcesados++;
              if (mensajesProcesados === totalMensajes) {
                imap.end();
                resolve(ultimoCodigo);
              }
            }
          });
        });

        fetcher.once("error", (err) => reject(err));
      });
    });

    imap.once("error", (err) => reject(err));
    imap.connect();
  });
};

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp!");
    } else if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log(`⚠️ Conexión cerrada. ¿Reconectar? ${shouldReconnect}`);
      if (shouldReconnect) startSock();
      else console.log("❌ La sesión fue cerrada. Escanea de nuevo el código QR.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const numero = from.split("@")[0].replace(/\D/g, "");
    console.log("📥 Mensaje recibido de:", from);
    console.log("📲 Verificando si puede usar bot:", numero);

    if (!puedeUsarBot(from)) {
      console.log(`❌ Número ${numero} NO autorizado`);
      return;
    }
    console.log(`✅ Número ${numero} autorizado`);

    const texto = msg.message.conversation || msg.message?.extendedTextMessage?.text || "";

    if (texto.trim().toLowerCase() === "#codigo") {
      await sock.sendMessage(from, { text: "🔍 Buscando tu código, un momento..." });

      try {
        const codigo = await buscarCodigo();
        if (codigo) {
          await sock.sendMessage(from, { text: `🔐 Tu código más reciente es: *${codigo}*` });
        } else {
          await sock.sendMessage(from, { text: `❌ No encontré ningún código reciente.` });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `⚠️ Error al buscar el código: ${err.message}` });
      }

      return;
    }

    // Si no es #codigo, reenviar al backend
    try {
      const res = await axios.post("http://localhost:5000/responder", {
        mensaje: texto,
        remitente: from
      });

      await delay(500);
      await sock.sendMessage(from, { text: res.data.respuesta });
    } catch (err) {
      console.error("❌ Error en el backend:", err.message);
      await sock.sendMessage(from, { text: "⚠️ Error al contactar al servidor." });
    }
  });
};

startSock();

