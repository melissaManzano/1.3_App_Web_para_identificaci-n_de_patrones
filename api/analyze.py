import json
import os
from http.server import BaseHTTPRequestHandler
from openai import OpenAI

# Lee la variable de entorno y limpia espacios o barras finales
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "").strip().rstrip("/")

# Modelo con capacidad de visión. gpt-5.6-luna es rápido y barato, ideal para
# una función serverless con límite de tiempo. gpt-5.6-terra/-sol ubican mejor
# los elementos pero son más lentos y caros (más razonamiento).
MODEL_NAME = os.environ.get("VISION_MODEL", "gpt-5.6-luna")

# Límite de tamaño del body (bytes). Vercel Hobby permite ~4.5MB por payload,
# por eso el frontend redimensiona/compacta la imagen antes de enviarla.
MAX_BODY_BYTES = 4_200_000

SYSTEM_PROMPT = (
    "Eres un sistema de visión por computadora. Se te entrega una imagen y, "
    "opcionalmente, el tipo de elemento a contar. Debes identificar cada "
    "instancia visible de esos elementos (o de los objetos principales si no "
    "se indica un tipo) y devolver ÚNICAMENTE un JSON válido con esta forma "
    "exacta, sin texto adicional ni explicaciones:\n\n"
    "{\n"
    '  "count": <numero entero de elementos encontrados>,\n'
    '  "elements": [\n'
    "    {\n"
    '      "id": <numero entero secuencial empezando en 1>,\n'
    '      "label": "<nombre corto del elemento>",\n'
    '      "x": <posicion horizontal del centro, valor decimal entre 0 y 1>,\n'
    '      "y": <posicion vertical del centro, valor decimal entre 0 y 1>,\n'
    '      "radius": <radio aproximado del circulo que lo encierra, decimal entre 0 y 1, relativo al ancho de la imagen>\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "x=0,y=0 es la esquina superior izquierda de la imagen. x=1,y=1 es la "
    "esquina inferior derecha. Sé lo más preciso posible ubicando el centro "
    "real de cada elemento. No inventes elementos que no estén presentes."
)


class handler(BaseHTTPRequestHandler):

    def add_cors_headers(self):
        origin = self.headers.get("Origin", "")
        if not ALLOWED_ORIGIN or origin.strip().rstrip("/") == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", origin if origin else "*")
            self.send_header("Vary", "Origin")

    def send_json(self, status_code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.add_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.add_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        self.send_json(405, {"error": "Este endpoint solamente acepta POST."})

    def do_POST(self):
        try:
            origin = self.headers.get("Origin", "")

            if ALLOWED_ORIGIN and origin.strip().rstrip("/") != ALLOWED_ORIGIN:
                self.send_json(403, {"error": "Origen no autorizado."})
                return

            content_length = int(self.headers.get("Content-Length", 0))

            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                self.send_json(413, {
                    "error": "La imagen es demasiado grande o la petición no es válida. "
                             "Intenta con una imagen más pequeña (máx. ~4MB en base64)."
                })
                return

            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            image_data_url = str(data.get("image", "")).strip()
            target_label = str(data.get("target", "")).strip()

            if not image_data_url.startswith("data:image/"):
                self.send_json(400, {"error": "Debes enviar una imagen válida en formato data URL."})
                return

            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                self.send_json(500, {"error": "OPENAI_API_KEY no está configurada."})
                return

            client = OpenAI(api_key=api_key)

            user_instruction = "Analiza la imagen adjunta y sigue las instrucciones del sistema."
            if target_label:
                user_instruction += f' Cuenta y ubica específicamente: "{target_label}".'

            response = client.chat.completions.create(
                model=MODEL_NAME,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_instruction},
                            {"type": "image_url", "image_url": {"url": image_data_url}},
                        ],
                    },
                ],
                # Los modelos GPT-5 usan max_completion_tokens en lugar de max_tokens.
                max_completion_tokens=1500,
            )

            raw_content = response.choices[0].message.content
            result = json.loads(raw_content)

            # Saneamos la forma de la respuesta por si el modelo se desvía un poco
            elements = result.get("elements", [])
            if not isinstance(elements, list):
                elements = []

            clean_elements = []
            for idx, el in enumerate(elements, start=1):
                try:
                    clean_elements.append({
                        "id": int(el.get("id", idx)),
                        "label": str(el.get("label", "elemento")),
                        "x": max(0.0, min(1.0, float(el.get("x", 0.5)))),
                        "y": max(0.0, min(1.0, float(el.get("y", 0.5)))),
                        "radius": max(0.01, min(0.5, float(el.get("radius", 0.05)))),
                    })
                except (TypeError, ValueError):
                    continue

            self.send_json(200, {
                "count": len(clean_elements),
                "elements": clean_elements,
            })

        except json.JSONDecodeError:
            self.send_json(400, {"error": "El cuerpo no contiene JSON válido."})
        except Exception as error:
            print(f"Error en /api/analyze: {type(error).__name__}: {error}")
            self.send_json(500, {"error": "No fue posible analizar la imagen con el modelo de IA."})