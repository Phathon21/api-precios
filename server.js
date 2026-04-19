import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

const SHEET_URL = "https://docs.google.com/spreadsheets/d/17JDlUX3SjoUdT4diUt8FnuWwoACVPQwC/export?format=csv";

// 💰 fórmulas
function calcularPrecio(base, esIphone) {
  base = Number(base);
  if (esIphone) return (base + 10000) * 2 + 50000;
  return (base + 10000) * 2 + 20000;
}

// 📥 leer sheet
async function obtenerDatos() {
  const res = await fetch(SHEET_URL);
  const text = await res.text();

  const results = [];

  return new Promise((resolve) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results));
  });
}

// 🔍 buscar modelo
function buscarProducto(lista, mensaje) {
  mensaje = mensaje.toLowerCase();

  return lista.find(item => {
    const modelo = (item.Modelo || item.modelo || "").toLowerCase();
    return mensaje.includes(modelo);
  });
}

// 🤖 endpoint
app.post("/precio", async (req, res) => {
  const mensaje = req.body.message.toLowerCase();

  const datos = await obtenerDatos();
  const producto = buscarProducto(datos, mensaje);

  if (!producto) {
    return res.json({
      respuesta: "No encontré ese modelo, probá con otro 📱"
    });
  }

  const base = producto.Precio || producto.precio || 0;
  const esIphone = mensaje.includes("iphone");

  const final = calcularPrecio(base, esIphone);

  return res.json({
    respuesta: `📱 ${producto.Modelo || producto.modelo}\n💰 Precio final: $${final}`
  });
});

app.listen(3000, () => console.log("API con Google Sheets activa"));
