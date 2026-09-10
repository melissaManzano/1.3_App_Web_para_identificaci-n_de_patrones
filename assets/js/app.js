// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const API_ENDPOINT = "/api/analyze";
const MAX_DIMENSION = 1024;   // redimensionamos para no exceder el límite de payload
const JPEG_QUALITY = 0.85;

// ---------------------------------------------------------------------------
// Referencias al DOM
// ---------------------------------------------------------------------------
const fileInput = document.getElementById("fileInput");
const fileDrop = document.getElementById("fileDrop");
const fileDropText = document.getElementById("fileDropText");
const targetInput = document.getElementById("targetInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusMsg = document.getElementById("statusMsg");
const canvas = document.getElementById("resultCanvas");
const ctx = canvas.getContext("2d");
const resultSummary = document.getElementById("resultSummary");
const countValue = document.getElementById("countValue");
const elementsList = document.getElementById("elementsList");

let currentImage = null;   // HTMLImageElement ya redimensionada
let currentDataUrl = null; // data URL en JPEG, lista para enviar a la API

// ---------------------------------------------------------------------------
// Selección de archivo (click o drag & drop)
// ---------------------------------------------------------------------------
fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) {
    handleFile(e.target.files[0]);
  }
});

["dragenter", "dragover"].forEach((evt) =>
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDrop.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((evt) =>
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDrop.classList.remove("dragover");
  })
);

fileDrop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("El archivo debe ser una imagen.", true);
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const resized = resizeImage(img);
      currentImage = resized.image;
      currentDataUrl = resized.dataUrl;

      canvas.width = resized.image.width;
      canvas.height = resized.image.height;
      ctx.drawImage(resized.image, 0, 0);

      fileDropText.textContent = `Imagen cargada: ${file.name}`;
      analyzeBtn.disabled = false;
      resultSummary.hidden = true;
      setStatus("");
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Redimensiona la imagen a un máximo de MAX_DIMENSION px por lado
// y la convierte a JPEG para mantener el payload pequeño.
function resizeImage(img) {
  let { width, height } = img;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(img, 0, 0, width, height);

  const dataUrl = tempCanvas.toDataURL("image/jpeg", JPEG_QUALITY);

  const resizedImg = new Image();
  resizedImg.src = dataUrl;

  return { image: resizedImg, dataUrl, width, height };
}

// ---------------------------------------------------------------------------
// Llamada a la API y dibujo de resultados
// ---------------------------------------------------------------------------
analyzeBtn.addEventListener("click", async () => {
  if (!currentDataUrl) return;

  analyzeBtn.disabled = true;
  setStatus("Analizando imagen con IA... esto puede tardar unos segundos.");
  resultSummary.hidden = true;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: currentDataUrl,
        target: targetInput.value.trim(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error desconocido al analizar la imagen.");
    }

    drawResults(data.elements);
    showSummary(data.count, data.elements);
    setStatus(`Listo. Se encontraron ${data.count} elemento(s).`);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "No fue posible analizar la imagen.", true);
  } finally {
    analyzeBtn.disabled = false;
  }
});

function drawResults(elements) {
  // Redibujamos la imagen base para limpiar marcadores anteriores
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

  elements.forEach((el) => {
    const cx = el.x * canvas.width;
    const cy = el.y * canvas.height;
    const r = el.radius * canvas.width;

    // Círculo
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, canvas.width * 0.004);
    ctx.strokeStyle = "#f97316";
    ctx.stroke();

    // Etiqueta numerada
    const fontSize = Math.max(14, canvas.width * 0.02);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const label = String(el.id);
    const textWidth = ctx.measureText(label).width;

    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(cx, cy - r, fontSize * 0.65, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx - textWidth / 2, cy - r);
  });
}

function showSummary(count, elements) {
  countValue.textContent = count;
  elementsList.innerHTML = "";

  elements.forEach((el) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>#${el.id}</b> — ${el.label}`;
    elementsList.appendChild(li);
  });

  resultSummary.hidden = false;
}

function setStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.classList.toggle("error", isError);
}