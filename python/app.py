from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/responder", methods=["POST"])
def responder():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"respuesta": "No recibí ningún mensaje válido."})

    mensaje = data.get("mensaje", "").lower()
    remitente = data.get("remitente", "desconocido")
    print(f"Mensaje recibido de {remitente}: {mensaje}")

    if "hola" in mensaje:
        respuesta = "¡Hola! ¿En qué puedo ayudarte?"
    elif "adios" in mensaje or "chao" in mensaje or "hasta luego" in mensaje:
        respuesta = "👋 ¡Hasta luego! Que tengas un buen día."
    elif "gracias" in mensaje or "muchas gracias" in mensaje:
        respuesta = "¡De nada! Estoy aquí para ayudarte."
    elif "ayuda" in mensaje:
        respuesta = ("Puedo responder saludos, despedidas y ayudarte con códigos de seguridad. "
                     "Prueba escribiendo 'hola' o '#codigo'.")
    elif "#codigo" in mensaje:
        respuesta = "🔐 Para obtener tu código, solo escribe *#codigo* por WhatsApp y lo buscaré."
    else:
        respuesta = "Lo siento, no entendí tu mensaje. Por favor, escribe 'hola', 'ayuda' o '#codigo'."

    print(f"Respuesta enviada a {remitente}: {respuesta}")
    return jsonify({"respuesta": respuesta})

if __name__ == "__main__":
    app.run(port=5000)

