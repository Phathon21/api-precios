import express from "express";

const app = express();
app.use(express.json());

// 🔧 Servicios fijos
const servicios = {
  frp: 35000,
  pin: 20000,
  patron: 20000,
  sistema: 20000,
  virus: 5000,
};

// 🔌 Pin de carga
function precioPinCarga(texto) {
  if (texto.includes("iphone")) return 80000;
  return 30000;
}

// 💰 Calcular precio
function calcularPrecio(base, esIphone) {
  base = Number(base);

  if (esIphone) {
    return (base + 10000) * 2 + 50000;
  } else {
    return (base + 10000) * 2 + 20000;
  }
}

// 🤖 Endpoint
app.post("/precio", async (req, res) => {
  const mensaje = req.body.message.toLowerCase();

  // servicios
  for (let key in servicios) {
    if (mensaje.includes(key)) {
      return res.json({
        respuesta: `🔧 ${key.toUpperCase()}\n💰 Precio final: $${servicios[key]}`
      });
    }
  }

  // pin carga
  if (mensaje.includes("pin de carga")) {
    const precio = precioPinCarga(mensaje);
    return res.json({
      respuesta: `🔌 Cambio de pin de carga\n💰 Precio final: $${precio}`
    });
  }

  // ejemplo A05
  if (mensaje.includes("a05")) {
    const base = 16500;
    const final = calcularPrecio(base, mensaje.includes("iphone"));

    return res.json({
      respuesta: `📱 Samsung A05\n💰 Precio final: $${final}`
    });
  }

  return res.json({
    respuesta: "No encontré el modelo, decime cuál es 📱"
  });
});

app.listen(3000, () => console.log("API funcionando"));
