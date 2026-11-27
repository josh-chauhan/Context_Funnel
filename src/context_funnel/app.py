from langchain_core.messages import HumanMessage
from .graph import chat_graph

# Testing that two separate threads are implemented and have different history:
while True:
    thread_id = input("Thread ID (A/B, or q to quit): ").strip()
    if thread_id.lower() == "q":
        break

    prompt = input("Your prompt: ")
    # Reusing a thread ID continues its history; a different ID starts an isolated conversation.
    result = chat_graph.invoke(
        {"messages": [HumanMessage(content=prompt)]},
        config={"configurable": {"thread_id": thread_id}},
    )
    print(result["messages"][-1].content)
