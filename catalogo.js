const MARCAS = [
    { nombre: "Samsung", alias: ["samsung", "sm", "sam"] },
    { nombre: "Motorola", alias: ["motorola", "moto", "mt"] },
    { nombre: "Xiaomi", alias: ["xiaomi", "redmi", "mi", "poco", "xi"] },
    { nombre: "Huawei", alias: ["huawei", "honor", "hw"] },
    { nombre: "iPhone", alias: ["iphone", "iph", "apple", "ip"] },
    { nombre: "LG", alias: ["lg"] },
    { nombre: "Nokia", alias: ["nokia"] },
    { nombre: "TCL", alias: ["tcl"] },
    { nombre: "Oppo", alias: ["oppo"] },
    { nombre: "Realme", alias: ["realme"] },
    { nombre: "Infinix", alias: ["infinix"] },
    { nombre: "Tecno", alias: ["tecno"] },
    { nombre: "ZTE", alias: ["zte", "nubia"] }
];

export function normalizarCatalogo(txt) {
    return String(txt || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s/+.-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function detectarCalidadUniversal(descripcion, esIphone = false) {
    const n = normalizarCatalogo(descripcion);
    if (esIphone && /\bincell\b/.test(n)) return "PREMIUM";
    if (/\bincell\b/.test(n)) return "INCELL";
    if (/\b(super\s+amoled|amoled|oled|mecanico|orig|original|ori)\b/.test(n)) {
        return "PREMIUM";
    }
    return "DESCONOCIDA";
}

export function detectarMarcoUniversal(descripcion) {
    const n = normalizarCatalogo(descripcion).replace(/\s+/g, " ");
    if (/\b(con\s*marco|c\s*\/\s*m|c\s*\/\s*marco|c\s+marco)\b/.test(n)) {
        return "CON_MARCO";
    }
    if (/\b(sin\s*marco|s\s*\/\s*m|s\s*\/\s*marco|s\s+marco)\b/.test(n)) {
        return "SIN_MARCO";
    }
    // En los listados de proveedores, la ausencia de C/M suele indicar módulo sin marco.
    return "SIN_MARCO";
}

export function detectarRedUniversal(descripcion) {
    const n = normalizarCatalogo(descripcion);
    const tiene4g = /\b4g\b/.test(n);
    const tiene5g = /\b5g\b/.test(n);
    if (tiene4g && tiene5g) return "4G_5G";
    if (tiene4g) return "4G";
    if (tiene5g) return "5G";
    return "DESCONOCIDA";
}

export function detectarMarcaUniversal(descripcion) {
    const n = normalizarCatalogo(descripcion);
    const tokens = new Set(n.split(/\s+/));
    if (/\biphone\b|\biph\b|\bapple\b|\biph(?=\d)/.test(n)) return "iPhone";
    if (/\bsamsung\b|\bsm(?=[ -]?[a-z]?\d)/.test(n)) return "Samsung";
    if (/\bmotorola\b|\bmoto\b|\bmt(?=[ -]?[a-z]?\d)/.test(n)) return "Motorola";
    if (/\bxiaomi\b|\bredmi\b|\bpoco\b|\bmi(?=[ -]?\d)|\bxi(?=[ -]?[a-z]?\d)/.test(n)) return "Xiaomi";
    if (/\bhuawei\b|\bhonor\b|\bhw(?=[ -]?[a-z]?\d)/.test(n)) return "Huawei";
    return MARCAS.find(marca => marca.alias.some(alias => tokens.has(alias)))?.nombre || "";
}

export function detectarMarcaDesdeConsulta(consulta) {
    return detectarMarcaUniversal(consulta);
}

export function quitarRedDeConsulta(consulta) {
    return normalizarCatalogo(consulta).replace(/\b(4g|5g)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function redExplicita(consulta) {
    const n = normalizarCatalogo(consulta);
    if (/\b4g\b/.test(n)) return "4G";
    if (/\b5g\b/.test(n)) return "5G";
    return "";
}

export function combinarRed(redConsulta, redOferta) {
    if (redConsulta === "4G" || redConsulta === "5G") return redConsulta;
    if (redOferta === "4G" || redOferta === "5G") return redOferta;
    if (redOferta === "4G_5G") return "4G_5G";
    return "DESCONOCIDA";
}

export function nombreCalidad(calidad) {
    if (calidad === "PREMIUM") return "Calidad Premium";
    if (calidad === "INCELL") return "Incell";
    return "Calidad pendiente";
}

export function nombreMarco(marco) {
    return marco === "CON_MARCO" ? "con marco" : "sin marco";
}

export function nombreRed(red) {
    if (red === "4G_5G") return "4G/5G";
    if (red === "4G" || red === "5G") return red;
    return "";
}

export function nombreModeloVisible(consulta) {
    const texto = String(consulta || "").trim().replace(/\s+/g, " ");
    if (!texto) return "Modelo no especificado";
    return texto
        .split(" ")
        .map((parte, indice) => {
            const n = normalizarCatalogo(parte);
            if (["samsung", "motorola", "xiaomi", "redmi", "poco", "iphone", "apple", "huawei", "honor"].includes(n)) {
                return parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase();
            }
            return parte.toUpperCase();
        })
        .join(" ");
}

export function construirNombreVariante(modelo, calidad, marco, red) {
    const redTexto = nombreRed(red);
    return `${modelo}${redTexto ? ` ${redTexto}` : ""} — ${nombreCalidad(calidad)} ${nombreMarco(marco)}`;
}

export function claveVariante(modelo, calidad, marco, red) {
    return [normalizarCatalogo(modelo), calidad, marco, red].join("|");
}

export function redCoincide(redConsulta, redOferta) {
    if (!redConsulta) return true;
    return redOferta === redConsulta || redOferta === "4G_5G" || redOferta === "DESCONOCIDA";
}

export function esMarcaIphone(consulta) {
    return detectarMarcaUniversal(consulta) === "iPhone" || /\b(iphone|iph|apple)\b/i.test(String(consulta || ""));
}
