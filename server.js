import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

const SHEET_URL = "https://docs.google.com/spreadsheets/d/17JDlUX3SjoUdT4diUt8FnuWwoACVPQwC/export?format=csv";

// 💰 calcular precio
function calcularPrecio(base, esIphone) {
  base = Number(base);
  if (esIphone) return (base + 10000) * 2 + 50000;
  return (base + 10000) * 2 + 20000;
}

// 📥 obtener datos
async function obtenerDatos() {
  const res = await fetch(SHEET_URL);
  const text = await res.text();

  const resultados = [];

  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", (data) => resultados.push(data))
      .on("end", () => resolve(resultados))
      .on("error", (err) => reject(err));
  });
}

// 🔍 búsqueda inteligente
function buscarProducto(lista, mensaje) {
  mensaje = mensaje.toLowerCase();

  let mejor = null;
  let mejorScore = 0;

  for (const item of lista) {
    const modelo = (item.Modelo || item.modelo || "").toLowerCase();

    const palabras = modelo.split(" ");
    let score = 0;

    for (const palabra of palabras) {
      if (mensaje.includes(palabra)) {
        score++;
      }
    }

    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }

  return mejorScore > 0 ? mejor : null;
}

// 🤖 endpoint
app.post("/precio", async (req, res) => {
  try {
    const mensaje = req.body.message.toLowerCase();

    const datos = await obtenerDatos();
    const producto = buscarProducto(datos, mensaje);

    if (!producto) {
      return res.json({
        respuesta: "No encontré ese modelo, decime modelo exacto 📱"
      });
    }

    const base = producto.Precio || producto.precio || 0;
    const esIphone = mensaje.includes("iphone");

    const final = calcularPrecio(base, esIphone);

    return res.json({
      respuesta: `📱 ${producto.Modelo || producto.modelo}\n💰 Precio final: $${final}`
    });

  } catch (error) {
    console.log("ERROR:", error);
    return res.json({
      respuesta: "Error al procesar la consulta ⚠️"
    });
  }
});

// ⚠️ PUERTO CORRECTO PARA RENDER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
