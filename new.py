import requests
import uuid

# Configurações da API
API_KEY = 'sk-2G1EFUhznHm7Z_Ap9uPBwzbi5VLinJ6iSvQQvrfeVCU' # Lembre-se de proteger sua chave!
URL = "http://34.57.48.16:7860/api/v1/run/c23c8e21-8de3-4e30-8a04-eb53ab5a007e"

# Configuração do payload (corpo da requisição)
payload = {
    "output_type": "chat",
    "input_type": "chat",
    "input_value": "hello world!",
    "session_id": str(uuid.uuid4())
}

headers = {
    "x-api-key": API_KEY,
    "Content-Type": "application/json"
}

try:
    # Realiza a requisição POST
    response = requests.post(URL, json=payload, headers=headers)
    
    # Levanta erro se a requisição falhar (4xx ou 5xx)
    response.raise_for_status()
    
    # Exibe o resultado
    print("Resposta da API:")
    print(response.json()) # .json() é melhor se o retorno for JSON

except requests.exceptions.RequestException as e:
    print(f"Erro na requisição: {e}")
except ValueError as e:
    print(f"Erro ao processar JSON: {e}")