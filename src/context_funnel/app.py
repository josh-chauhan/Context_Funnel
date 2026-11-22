import os
from dotenv import load_dotenv
from langchain_ollama import ChatOllama
# Used ollama for offline availability and ease of use. 
# Code is easy to interchange with other open source models of your liking, however.
load_dotenv()
def get_model () -> ChatOllama:
    return ChatOllama(

        model=os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        
    )
model = get_model()

prompt = input("Ask me a question:\n ")

print(model.invoke(prompt).content)
