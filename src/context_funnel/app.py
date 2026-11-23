from langchain_core.messages import HumanMessage
from .graph import chat_graph


prompt = input("Ask me anything:\n ")


result = chat_graph.invoke({

    "messages": [HumanMessage(content=prompt)]
})
print(result["messages"][-1].content)
